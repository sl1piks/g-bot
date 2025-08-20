// Инициализация Telegram WebApp
let tg = window.Telegram?.WebApp;
let user = null;
let isAdmin = false;
let profitData = []; // Будет заполнен данными из базы через API бота
// Текущий фильтр для списка профитов (нужно, чтобы displayFilteredProfits знал, как сортировать)
let currentProfitFilter = 'all';

// Пагинация
let currentPage = 0;
const PROFITS_PER_PAGE = 5;
let hasMoreProfits = true;

// Статистика проекта
let projectStats = {
    totalAmount: 0,
    workersCount: 0,
    profitsCount: 0
};

// Кеш пользователей Telegram (username -> user data)
let telegramUsersCache = new Map();

// Функция для получения данных пользователя через Telegram WebApp
function getTelegramUserData(username) {
    return new Promise((resolve, reject) => {
        // Проверяем кеш
        if (telegramUsersCache.has(username)) {
            resolve(telegramUsersCache.get(username));
            return;
        }

        // Если WebApp не доступен, возвращаем базовые данные
        if (!tg || !tg.initData) {
            const basicData = {
                id: null,
                first_name: username,
                last_name: '',
                username: username,
                source: 'fallback'
            };
            telegramUsersCache.set(username, basicData);
            resolve(basicData);
            return;
        }

        // Парсим initData для получения информации о пользователе
        try {
            const initData = tg.initData;
            const params = new URLSearchParams(initData);
            const userParam = params.get('user');
            
            if (userParam) {
                const currentUser = JSON.parse(decodeURIComponent(userParam));
                
                // Если это тот же пользователь, которого мы ищем
                if (currentUser.username === username) {
                    const userData = {
                        id: currentUser.id,
                        first_name: currentUser.first_name || username,
                        last_name: currentUser.last_name || '',
                        username: currentUser.username || username,
                        source: 'telegram_webapp'
                    };
                    telegramUsersCache.set(username, userData);
                    resolve(userData);
                    return;
                }
            }

            // Если не удалось найти пользователя в WebApp данных, возвращаем базовую информацию
            const fallbackData = {
                id: null,
                first_name: username,
                last_name: '',
                username: username,
                source: 'webapp_fallback'
            };
            telegramUsersCache.set(username, fallbackData);
            resolve(fallbackData);

        } catch (error) {
            console.warn('Ошибка при парсинге Telegram WebApp данных:', error);
            const errorData = {
                id: null,
                first_name: username,
                last_name: '',
                username: username,
                source: 'error_fallback'
            };
            telegramUsersCache.set(username, errorData);
            resolve(errorData);
        }
    });
}

// Функция для автоматического добавления воркера с данными из WebApp
async function addWorkerWithTelegramData(username) {
    try {
        const userData = await getTelegramUserData(username);
        
        // Отправляем данные на сервер для сохранения в базе данных
        const response = await fetch('/api/workers/add-telegram', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: userData.username,
                telegram_id: userData.id,
                first_name: userData.first_name,
                last_name: userData.last_name,
                source: userData.source
            })
        });

        const result = await response.json();
        
        return {
            success: response.ok,
            data: result,
            user_info: userData
        };
        
    } catch (error) {
        console.error('Ошибка при добавлении воркера с данными Telegram:', error);
        return {
            success: false,
            error: error.message,
            user_info: null
        };
    }
}

// Функция для форматирования чисел в формате 8.698,932
function formatNumber(num) {
    if (!num) return "0";
    
    // Удаляем все пробелы и разделители, если они есть
    let cleanNum = typeof num === 'string' ? num.replace(/[\s\.]/g, '').replace(',', '.') : num.toString();
    
    // Преобразуем строку в число
    const number = parseFloat(cleanNum);
    
    // Разделяем число на целую и дробную части
    const parts = number.toString().split('.');
    
    // Форматируем целую часть с точками между тысячными разрядами
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    // Собираем число с запятой между целой и дробной частью
    return parts.length > 1 ? parts[0] + ',' + parts[1] : parts[0];
}

// Функция для форматирования чисел с ограничением знаков после запятой
function formatNumberWithDecimals(num, maxDecimals = 3) {
    if (!num || num === 0) return "0";
    
    // Преобразуем в число
    const number = typeof num === 'string' ? parseFloat(num) : num;
    
    // Округляем до максимального количества знаков после запятой
    const rounded = Math.round(number * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
    
    // Разделяем на целую и дробную части
    const parts = rounded.toString().split('.');
    
    // Форматируем целую часть с точками между тысячными разрядами
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    // Ограничиваем дробную часть до maxDecimals знаков
    if (parts.length > 1 && parts[1].length > maxDecimals) {
        parts[1] = parts[1].substring(0, maxDecimals);
    }
    
    // Убираем лишние нули в конце дробной части
    if (parts.length > 1) {
        parts[1] = parts[1].replace(/0+$/, '');
        if (parts[1] === '') {
            parts.pop(); // Убираем пустую дробную часть
        }
    }
    
    // Собираем число с запятой между целой и дробной частью
    return parts.length > 1 ? parts[0] + ',' + parts[1] : parts[0];
}

// Парсер суммы: корректно обрабатывает строки с тысячными разделителями (точки/пробелы)
// и десятичными разделителями (запятая или точка).
function parseAmount(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return val;

    let s = String(val).trim();

    // Удаляем пробелы
    s = s.replace(/\s+/g, '');

    // Если есть и запятая и точка - считаем, что точка разделитель тысяч, запятая - десятичный
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
        s = s.replace(/\./g, '').replace(/,/g, '.');
        return parseFloat(s) || 0;
    }

    // Если есть запятая - заменим на точку
    if (s.indexOf(',') !== -1) {
        s = s.replace(/\./g, '').replace(/,/g, '.');
        return parseFloat(s) || 0;
    }

    // Есть только точки. Может быть либо десятичная точка (например 12345.123)
    // либо точка как разделитель тысяч (например 5.400 -> 5400).
    if (s.indexOf('.') !== -1) {
        const after = s.split('.').pop();
        // Если после последней точки ровно 3 символа, скорее всего это дробная часть (toFixed(3))
        if (after.length === 3) {
            return parseFloat(s) || 0;
        } else {
            // Иначе убираем все точки (точки как разделители тысяч)
            s = s.replace(/\./g, '');
            return parseFloat(s) || 0;
        }
    }

    return parseFloat(s) || 0;
}

// Настройка загрузочного экрана и инициализация приложения
document.addEventListener('DOMContentLoaded', function() {
    // Инициализация Telegram WebApp
    initTelegramWebApp();
    
    // Адаптация под размер окна Telegram
    adaptToTelegramWindow();
    
    // Имитация загрузки страницы
    setTimeout(function() {
        const loader = document.querySelector('.loader-container');
        
        // Добавляем плавное исчезновение
        if (loader) {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            
            // Удаляем элемент из DOM через секунду
            setTimeout(() => {
                if (loader.parentNode) {
                    loader.parentNode.removeChild(loader);
                }
                
                // Инициализируем основной функционал после загрузки
                (async () => {
                    await initMainFunctionality();
                })();
            }, 500);
        }
    }, 2000); // Уменьшено время загрузки для лучшего UX
});

// Адаптация под размер окна Telegram
function adaptToTelegramWindow() {
    if (tg) {
        // Устанавливаем размеры WebApp
        tg.ready();
        tg.expand();
        
        // Устанавливаем цвет заголовка
        tg.setHeaderColor('#408d3d');
        
        // Применяем тему Telegram
        const themeParams = tg.themeParams;
        if (themeParams) {
            applyTelegramTheme(themeParams);
        }
        
        // Скрываем кнопку "Назад" если она не нужна
        tg.BackButton.hide();
        
        // Показываем главную кнопку если пользователь админ
        if (isAdmin) {
            tg.MainButton.setText('Добавить профит');
            tg.MainButton.color = '#ffc107';
            tg.MainButton.textColor = '#ffffff';
            tg.MainButton.show();
            
            tg.MainButton.onClick(() => {
                const modal = document.getElementById('add-profit-modal');
                if (modal) {
                    modal.classList.add('active');
                }
            });
        }
    }
}

// Применение темы Telegram
function applyTelegramTheme(themeParams) {
    const root = document.documentElement;
    
    // Применяем цвета темы Telegram
    if (themeParams.bg_color) {
        root.style.setProperty('--tg-theme-bg-color', themeParams.bg_color);
        document.body.style.backgroundColor = themeParams.bg_color;
    }
    
    if (themeParams.text_color) {
        root.style.setProperty('--tg-theme-text-color', themeParams.text_color);
    }
    
    if (themeParams.hint_color) {
        root.style.setProperty('--tg-theme-hint-color', themeParams.hint_color);
    }
    
    if (themeParams.link_color) {
        root.style.setProperty('--tg-theme-link-color', themeParams.link_color);
    }
    
    if (themeParams.button_color) {
        root.style.setProperty('--tg-theme-button-color', themeParams.button_color);
    }
    
    if (themeParams.button_text_color) {
        root.style.setProperty('--tg-theme-button-text-color', themeParams.button_text_color);
    }
}

// Инициализация основного функционала
async function initMainFunctionality() {
    // Инициализируем обработчики кнопок
    initButtonHandlers();
    
    // Загружаем данные из базы данных (showProfitCards уже вызывается внутри)
    await fetchProjectData();
    
    // Анимируем элементы
    animateElementsIn();
    
    // Инициализируем обработчики модального окна
    initModalHandlers();
    
    // Инициализируем фильтры профитов
    initProfitFilters();
    
    // Обновляем UI в зависимости от роли пользователя
    updateUIBasedOnRole();
}

// Инициализация обработчиков кнопок
function initButtonHandlers() {
    // Обработчик кнопки обновления данных
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async function() {
            const btnIcon = refreshBtn.querySelector('.btn-icon');
            const btnText = refreshBtn.querySelector('span:last-child');
            
            // Анимация загрузки
            if (btnIcon) btnIcon.style.animation = 'spin 1s linear infinite';
            if (btnText) btnText.textContent = 'Обновление...';
            refreshBtn.disabled = true;
            
            try {
                // Сбрасываем пагинацию и загружаем данные заново
                currentPage = 0;
                profitData = [];
                hasMoreProfits = true;
                
                await fetchProjectData();
                console.log('Данные успешно обновлены из базы данных');
            } catch (error) {
                console.error('Ошибка при обновлении данных:', error);
            }
            
            // Восстанавливаем кнопку
            setTimeout(() => {
                if (btnIcon) btnIcon.style.animation = '';
                if (btnText) btnText.textContent = 'Обновить данные';
                refreshBtn.disabled = false;
            }, 1000);
        });
    }
}

// Инициализация Telegram WebApp
async function initTelegramWebApp() {
    // Проверяем, запущено ли приложение в Telegram
    const isTelegramWebApp = window.Telegram && window.Telegram.WebApp;
    
    // Получаем параметры из URL
    const urlParams = new URLSearchParams(window.location.search);
    const allowDirect = urlParams.get('allow_direct') === 'true';
    
    // Если это Telegram WebApp
    if (isTelegramWebApp) {
        // Сообщаем Telegram, что WebApp готов для расширения
        tg.expand();
        
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            user = tg.initDataUnsafe.user;
            
            // Получаем параметры из URL, которые передал бот
            isAdmin = urlParams.get('admin') === 'true';
            
            // Обновляем информацию о пользователе
            document.getElementById('user-name').textContent = user.first_name || 'Пользователь';
            
            if (user.photo_url) {
                document.getElementById('user-avatar').src = user.photo_url;
            }
            
            console.log('Telegram user initialized:', user);
            console.log('Is admin:', isAdmin);
            
            // Получаем статистику и данные профитов
            await fetchProjectData();
        }
    } else if (allowDirect) {
        // Режим тестирования (только если есть параметр allow_direct=true)
        console.log('Running in test mode with allow_direct=true');
        
        // Для тестирования - считаем всех пользователей админами
        isAdmin = urlParams.get('admin') === 'true' || true;
        document.getElementById('user-name').textContent = 'Тестовый режим';
        
        // Загружаем данные из базы данных
        await fetchProjectData();
    }
}

// Функция для получения данных проекта из базы данных через API
async function fetchProjectData(loadMore = false) {
    try {
        console.log('Загрузка данных из profit_database.db...');
        
        let apiUrl = 'http://127.0.0.1:5000/api/data';
        
        // Если это загрузка дополнительных данных, используем API для профитов с пагинацией
        if (loadMore) {
            apiUrl = `http://127.0.0.1:5000/api/profits?limit=${PROFITS_PER_PAGE}&offset=${currentPage * PROFITS_PER_PAGE}`;
        }
        
        // Запрос к API серверу
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Данные получены из базы:', data);
        
        if (loadMore) {
            // Обработка дополнительных профитов
            if (data.profits && Array.isArray(data.profits) && data.profits.length > 0) {
                const newProfits = data.profits.map(p => ({
                    success: true,
                    amount: p.amount ? p.amount.toString() : "0",
                    workerPercent: (p.worker_percent || 70) + "%",
                    service: p.service || "Неизвестно",
                    worker: p.worker_name || "Неизвестен",
                    date: new Date(p.date),
                    projectAmount: p.project_amount ? formatNumber(p.project_amount) : "0"
                }));
                
                // Добавляем новые профиты к существующим
                profitData.push(...newProfits);
                
                // Обновляем информацию о наличии дополнительных данных
                hasMoreProfits = data.has_more || false;
                currentPage++;
                
                console.log(`Загружено ${newProfits.length} дополнительных профитов`);
                return newProfits;
            } else {
                hasMoreProfits = false;
                return [];
            }
        } else {
            // Первоначальная загрузка данных
            // Обновляем статистику проекта
            projectStats = {
                totalAmount: data.total_amount || 0,
                workersCount: data.workers_count || 0,
                profitsCount: data.profits_count || 0
            };
            
            // Обновляем счетчики на странице
            updateStatistics(projectStats);
            
            // Обрабатываем список профитов из базы данных
            if (data.profits && Array.isArray(data.profits) && data.profits.length > 0) {
                // Берем только первые профиты для начального отображения
                const initialProfits = data.profits.slice(0, PROFITS_PER_PAGE);
                
                profitData = initialProfits.map(p => ({
                    success: true,
                    amount: p.amount ? p.amount.toString() : "0",
                    workerPercent: (p.worker_percent || 70) + "%",
                    service: p.service || "Неизвестно",
                    worker: p.worker_name || "Неизвестен",
                    date: new Date(p.date),
                    projectAmount: p.project_amount ? formatNumber(p.project_amount) : "0"
                }));
                
                // Проверяем, есть ли еще данные для загрузки
                hasMoreProfits = data.profits.length > PROFITS_PER_PAGE;
                currentPage = 1;
                
                console.log(`Загружено ${profitData.length} профитов из базы данных`);
                
                // Обновляем карточки профитов
                showProfitCards();
                return profitData;
            } else {
                console.log('Профитов в базе данных не найдено');
                profitData = [];
                hasMoreProfits = false;
                showProfitCards();
                return [];
            }
        }
        
    } catch (error) {
        console.error('Ошибка при загрузке данных из базы:', error);
        console.log('Не удалось загрузить данные из базы');
        
        if (!loadMore) {
            // При ошибке показываем пустые данные только для первоначальной загрузки
            profitData = [];
            projectStats = {
                totalAmount: 0,
                workersCount: 0,
                profitsCount: 0
            };
            updateStatistics(projectStats);
            showProfitCards();
            return [];
        }
        
        hasMoreProfits = false;
        return [];
    }
}

// Загрузка демо-данных для тестирования
function loadDemoData() {
    // Демо данные для статистики
    projectStats = {
        totalAmount: 34463,
        workersCount: 6,
        profitsCount: 156
    };
    
    // Создаем демо данные профитов с накопительной суммой кассы, начиная с 0
    let currentProjectAmount = 0; // Начальная сумма кассы = 0
    
    const demoProjects = [
        { amount: "5.400", workerPercent: "85%", service: "WalletPay", worker: "#cryptohunter", date: new Date(2025, 7, 17, 21, 10) },
        { amount: "12.300", workerPercent: "65%", service: "FiatGate", worker: "#protrader", date: new Date(2025, 7, 18, 15, 20) },
        { amount: "7.850", workerPercent: "75%", service: "CryptoEx", worker: "#moneymaker", date: new Date(2025, 7, 18, 19, 30) },
        { amount: "15.200", workerPercent: "70%", service: "BankApp", worker: "#cryptomaster", date: new Date(2025, 7, 18, 22, 45) },
        { amount: "9.600", workerPercent: "80%", service: "MarketPlace", worker: "#unluckdays", date: new Date(2025, 7, 19, 10, 15) }
    ];

    // Демо данные профитов с правильной накопительной суммой кассы
    profitData = demoProjects.map(project => {
        currentProjectAmount += parseFloat(project.amount.replace(',', '.')) * 1000; // конвертируем в полную сумму
        return {
            success: true,
            amount: project.amount,
            workerPercent: project.workerPercent,
            service: project.service,
            worker: project.worker,
            projectAmount: currentProjectAmount.toLocaleString('ru-RU'),
            date: project.date
        };
    }).reverse(); // Переворачиваем, чтобы новые были сверху
    
    // Обновляем статистику и карточки
    updateStatistics(projectStats);
}

// Функция анимации появления элементов страницы
function animateElementsIn() {
    // Список элементов для анимации
    const elementsToAnimate = [
        '.logo', 
        '.menu li', 
        '.hero-content h1', 
        '.hero-content p', 
        '.btn-primary', 
        '.floating-icon',
        '.stat-item'
    ];
    
    // Добавление класса с анимацией с задержкой для каждого элемента
    let delay = 0.2;
    elementsToAnimate.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = `opacity 0.6s ease-in-out ${delay}s, transform 0.6s ease-in-out ${delay}s`;
            
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, delay * 1000);
            
            delay += 0.1;
        });
    });
}

// Управление мобильным меню с современными эффектами
document.addEventListener('DOMContentLoaded', function() {
    const menuToggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.menu');
    const menuClose = document.querySelector('.menu-close');
    let isMenuOpen = false;
    
    // Функция открытия меню
    function openMenu() {
        if (isMenuOpen) return;
        
        isMenuOpen = true;
        menu.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Анимация иконки toggle кнопки
        const toggleIcon = menuToggle.querySelector('i');
        if (toggleIcon) {
            toggleIcon.style.transform = 'rotate(90deg) scale(1.2)';
            setTimeout(() => {
                toggleIcon.classList.remove('fa-bars');
                toggleIcon.classList.add('fa-times');
                toggleIcon.style.transform = 'rotate(0deg) scale(1)';
            }, 200);
        }
        
        // Добавляем задержку для анимации появления элементов
        const menuItems = menu.querySelectorAll('li');
        menuItems.forEach((item, index) => {
            item.style.animationDelay = `${(index + 1) * 0.1}s`;
        });
        
        // Звуковой эффект открытия (если поддерживается)
    }
    
    // Функция закрытия меню
    function closeMenu() {
        if (!isMenuOpen) return;
        
        isMenuOpen = false;
        
        // Анимация исчезновения элементов
        const menuItems = menu.querySelectorAll('li a');
        menuItems.forEach((item, index) => {
            setTimeout(() => {
                item.style.transform = 'translateY(20px) scale(0.9)';
                item.style.opacity = '0';
            }, index * 50);
        });
        
        // Закрытие меню с задержкой
        setTimeout(() => {
            menu.classList.remove('active');
            document.body.style.overflow = '';
            
            // Сброс стилей элементов
            menuItems.forEach(item => {
                item.style.transform = '';
                item.style.opacity = '';
            });
            
            // Анимация иконки toggle кнопки
            const toggleIcon = menuToggle.querySelector('i');
            if (toggleIcon) {
                toggleIcon.style.transform = 'rotate(-90deg) scale(1.2)';
                setTimeout(() => {
                    toggleIcon.classList.remove('fa-times');
                    toggleIcon.classList.add('fa-bars');
                    toggleIcon.style.transform = 'rotate(0deg) scale(1)';
                }, 200);
            }
        }, menuItems.length * 50);
        
        // Звуковой эффект закрытия
    }
    
    // Звуковые эффекты для меню
    
    
    // Обработчики событий
    if (menuToggle) {
        menuToggle.addEventListener('click', function(e) {
            e.preventDefault();
            if (isMenuOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }
    
    if (menuClose) {
        menuClose.addEventListener('click', function(e) {
            e.preventDefault();
            closeMenu();
        });
    }
    
    // Закрытие меню при клике на пункт меню
    const menuItems = document.querySelectorAll('.menu a:not(.menu-close)');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            if (isMenuOpen) {
                closeMenu();
            }
        });
    });
    
    // Закрытие меню по Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isMenuOpen) {
            closeMenu();
        }
    });
    
    // Закрытие меню при клике вне меню
    document.addEventListener('click', function(e) {
        if (isMenuOpen && !menu.contains(e.target) && !menuToggle.contains(e.target)) {
            closeMenu();
        }
    });
});

// Функция для обновления статистики на странице
function updateStatistics(stats) {
    // Обновляем атрибуты data-target для каждого счетчика по порядку в HTML
    const counters = document.querySelectorAll('.counter[data-target]');
    
    if (counters.length >= 3) {
        // Первый счетчик - общая касса
        counters[0].setAttribute('data-target', Math.floor(stats.totalAmount).toString());
        
        // Второй счетчик - активные воркеры  
        counters[1].setAttribute('data-target', stats.workersCount.toString());
        
        // Третий счетчик - успешные профиты
        counters[2].setAttribute('data-target', stats.profitsCount.toString());
    }
    
    // Анимируем счетчики
    animateCounters();
}

// Функция анимации счетчиков
function animateCounters() {
    const counters = document.querySelectorAll('.counter');
    
    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-target'));
        const duration = 2000; // 2 секунды
        const startTime = Date.now();
        
        function updateCounter() {
            const currentTime = Date.now();
            const elapsedTime = currentTime - startTime;
            
            if (elapsedTime < duration) {
                const progress = elapsedTime / duration;
                const value = Math.floor(progress * target);
                counter.textContent = value.toLocaleString();
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = target.toLocaleString();
            }
        }
        
        updateCounter();
    });
}

// Функция для создания и показа карточек профитов
// Функция для создания одной карточки профита
function createProfitCard(profit) {
    // Форматируем дату, если она есть
    let dateStr = '';
    if (profit.date) {
        const date = profit.date instanceof Date ? profit.date : new Date(profit.date);
        dateStr = date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Создаем элемент карточки
    const card = document.createElement('div');
    card.className = 'profit-card';
    
    card.innerHTML = `
        <div class="profit-header">
            <i class="fas fa-trophy"></i>
            <h3>🎉 Успешная мамонтизация!</h3>
        </div>
        <div class="profit-details">
            <div class="profit-amount">
                <span class="amount">${formatNumber(profit.amount)}₽</span>
                <span class="worker-percent">(${profit.workerPercent})</span>
            </div>
            <div class="profit-service">
                <i class="fas fa-credit-card"></i>
                <span class="service-name">${profit.service}</span>
            </div>
            <div class="profit-worker">
                <i class="fas fa-user"></i>
                <span class="worker-name">${profit.worker}</span>
            </div>
            <div class="profit-project">
                <i class="fas fa-wallet"></i>
                <span class="project-amount">Касса проекта: ${formatNumber(profit.projectAmount)}₽</span>
            </div>
            ${dateStr ? `<div class="profit-date">
                <i class="fas fa-clock"></i>
                <span class="date">${dateStr}</span>
            </div>` : ''}
        </div>
    `;
    
    return card;
}

function showProfitCards() {
    const container = document.querySelector('.profit-container');
    if (!container) return;
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Сортируем профиты по дате (сначала новые)
    const sortedProfits = [...profitData].sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date();
        const dateB = b.date instanceof Date ? b.date : new Date();
        return dateB - dateA;
    });
    
    // Если нет данных, показываем сообщение
    if (sortedProfits.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-profits';
        emptyMessage.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <p>Пока нет данных о профитах</p>
            <p>Данные о новых профитах будут появляться здесь</p>
        `;
        container.appendChild(emptyMessage);
        
        // Скрываем кнопку "Загрузить еще" если нет данных
        const loadMoreBtn = document.querySelector('.btn-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'none';
        }
        return;
    }
    
    let delay = 0.2;
    
    sortedProfits.forEach((profit, index) => {
        const card = createProfitCard(profit);
        
        // Добавляем карточку в контейнер
        container.appendChild(card);
        
        // Добавляем анимацию с задержкой
        setTimeout(() => {
            card.style.transition = `opacity 0.5s ease-in-out, transform 0.5s ease-in-out`;
            card.classList.add('show');
        }, delay * 1000);
        
        delay += 0.15;
    });
    
    // Показываем кнопку "Загрузить еще" если есть еще данные
    const loadMoreBtn = document.querySelector('.btn-load-more');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = hasMoreProfits ? 'block' : 'none';
    }
}
    
    // Добавляем обработчик для кнопки "Загрузить еще"
    const loadMoreBtn = document.querySelector('.btn-load-more');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', async () => {
            // Проверяем, есть ли еще данные для загрузки
            if (!hasMoreProfits) {
                console.log('Нет больше данных для загрузки');
                loadMoreBtn.style.display = 'none';
                return;
            }
            
            // Анимация смены текста кнопки
            loadMoreBtn.classList.add('loading');
            loadMoreBtn.disabled = true;
            
            console.log('🚀 Загружаем дополнительные данные из базы данных...');
            
            try {
                // Загружаем дополнительные данные
                const newProfits = await fetchProjectData(true);
                
                if (newProfits && newProfits.length > 0) {
                    console.log(`✨ Загружено ${newProfits.length} новых карточек`);
                    
                    // Добавляем новые карточки в контейнер
                    const container = document.querySelector('.profit-container');
                    if (container) {
                        newProfits.forEach((profit, index) => {
                            const card = createProfitCard(profit);
                            card.className = 'profit-card fade-in-new';
                            card.style.animationDelay = `${index * 150}ms`;
                            container.appendChild(card);
                        });
                    }
                    
                    console.log(`📋 Добавлено ${newProfits.length} новых карточек`);
                } else {
                    console.log('Нет новых данных для загрузки');
                    hasMoreProfits = false;
                }
                
                // Скрываем кнопку если больше нет данных
                if (!hasMoreProfits) {
                    loadMoreBtn.style.display = 'none';
                }
                
                // Возвращаем кнопку в рабочее состояние
                loadMoreBtn.classList.remove('loading');
                loadMoreBtn.disabled = false;
                
            } catch (error) {
                console.error('❌ Ошибка при загрузке:', error);
                
                loadMoreBtn.classList.remove('loading');
                loadMoreBtn.disabled = false;
            }
        });
    }


// Инициализация фильтров профитов
function initProfitFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Убираем активный класс у всех кнопок
            filterBtns.forEach(b => b.classList.remove('active'));
            
            // Добавляем активный класс к текущей кнопке
            this.classList.add('active');
            
            // Получаем тип фильтра
            const filter = this.getAttribute('data-filter');
            
            // Применяем фильтр
            applyProfitFilter(filter);
        });
    });
}

// Применение фильтра к профитам
function applyProfitFilter(filterType) {
    const container = document.querySelector('.profit-container');
    
    // Добавляем анимационный класс
    if (container) {
        container.classList.add('filter-change');
        
        // Удаляем класс после анимации
        setTimeout(() => {
            container.classList.remove('filter-change');
        }, 500);
    }
    
    // Сохраняем текущий фильтр для дальнейшего использования при отображении
    currentProfitFilter = filterType || 'all';

    let filteredData = [...profitData];
    
    switch(filterType) {
        case 'today':
            // Фильтр "Сегодня" - показываем ТОЛЬКО профиты за текущий день
            const today = new Date();
            const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
            
            filteredData = filteredData.filter(profit => {
                const profitDate = profit.date instanceof Date ? profit.date : new Date(profit.date);
                return profitDate >= todayStart && profitDate < todayEnd;
            });
            break;
            
        case 'top':
            // Фильтр "Топ" - показываем топ профиты (по сумме)
            filteredData = filteredData
                .sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount))
                .slice(0, 5); // Показываем топ-5 профитов
            break;
            
        case 'all':
        default:
            // Показываем все профиты, сортированные по новизне (сначала новые)
            filteredData = filteredData.sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : new Date(a.date);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date);
                return dateB - dateA;
            });
            break;
    }
    
    // Небольшая задержка для плавной анимации
    setTimeout(() => {
        displayFilteredProfits(filteredData);
    }, 100);
}

// Отображение отфильтрованных профитов
function displayFilteredProfits(filteredData) {
    const container = document.querySelector('.profit-container');
    if (!container) return;
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Сортируем профиты: если текущий фильтр 'top' - по сумме, иначе по дате (сначала новые)
    let sortedProfits = [...filteredData];
    if (currentProfitFilter === 'top') {
        sortedProfits = sortedProfits.sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount));
    } else {
        sortedProfits = sortedProfits.sort((a, b) => {
            const dateA = a.date instanceof Date ? a.date : new Date(a.date);
            const dateB = b.date instanceof Date ? b.date : new Date(b.date);
            return dateB - dateA;
        });
    }
    
    // Если нет данных, показываем сообщение
    if (sortedProfits.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-profits';
        emptyMessage.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <p>Нет профитов для выбранного фильтра</p>
            <p>Попробуйте выбрать другой период</p>
        `;
        container.appendChild(emptyMessage);
        return;
    }
    
    let delay = 0.2;
    
    sortedProfits.forEach((profit, index) => {
        // Форматируем дату, если она есть
        let dateStr = '';
        if (profit.date) {
            const date = profit.date instanceof Date ? profit.date : new Date(profit.date);
            dateStr = date.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        // Создаем элемент карточки
        const card = document.createElement('div');
        card.className = 'profit-card';
        
        // Используем шаблон карточек как в 'Топ' для всех видов фильтрации
        card.innerHTML = `
            <div class="profit-header">
                <i class="fas fa-trophy"></i>
                <h3>🎉 Успешная мамонтизация!</h3>
            </div>
            <div class="profit-details">
                <div class="profit-amount">
                    <span class="amount">${formatNumber(profit.amount)}₽</span>
                    <span class="worker-percent">(${profit.workerPercent})</span>
                </div>
                <div class="profit-service">
                    <i class="fas fa-credit-card"></i>
                    <span class="service-name">${profit.service}</span>
                </div>
                <div class="profit-worker">
                    <i class="fas fa-user"></i>
                    <span class="worker-name">${profit.worker}</span>
                </div>
                <div class="profit-project">
                    <i class="fas fa-wallet"></i>
                    <span class="project-amount">Касса проекта: ${formatNumber(profit.projectAmount)}₽</span>
                </div>
                ${dateStr ? `<div class="profit-date">
                    <i class="fas fa-clock"></i>
                    <span class="date">${dateStr}</span>
                </div>` : ''}
            </div>
        `;
        
        // Добавляем карточку в контейнер
        container.appendChild(card);
        
        // Анимация появления с задержкой
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, delay * 1000);
        
        delay += 0.15;
    });
}

// Добавление эффектов при прокрутке
window.addEventListener('scroll', function() {
    const header = document.querySelector('header');
    const scrollPosition = window.scrollY;
    
    // Изменение стиля header при прокрутке
    if (scrollPosition > 50) {
        header.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.1)';
    } else {
        header.style.boxShadow = '0 2px 15px rgba(0, 0, 0, 0.05)';
    }
    
    // Анимация элементов при прокрутке
    animateOnScroll();
});

// Функция для анимации элементов при прокрутке
function animateOnScroll() {
    const elements = document.querySelectorAll('.profit-card, .profit-cards h2, .stat-item');
    
    elements.forEach(element => {
        const elementPosition = element.getBoundingClientRect().top;
        const windowHeight = window.innerHeight;
        
        if (elementPosition < windowHeight * 0.9) {
            element.classList.add('animated');
            
            // Добавляем стили для анимированных элементов, если их нет
            if (!element.classList.contains('animation-added')) {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
                element.classList.add('animation-added');
            }
        }
    });
}

// Инициализируем анимацию для элементов при прокрутке
document.addEventListener('DOMContentLoaded', function() {
    // Установить начальную непрозрачность для статистических элементов
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(item => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(30px)';
        item.style.transition = 'opacity 0.8s ease-in-out, transform 0.8s ease-in-out';
    });
    
    // Запускаем анимацию при прокрутке
    animateOnScroll();
    
    // Добавляем интерактивность для иконок в hero-секции
    const icons = document.querySelectorAll('.floating-icon');
    
    document.addEventListener('mousemove', function(e) {
        const mouseX = e.clientX / window.innerWidth;
        const mouseY = e.clientY / window.innerHeight;
        
        icons.forEach((icon, index) => {
            const offsetX = 30 * (mouseX - 0.5) * (index + 1);
            const offsetY = 30 * (mouseY - 0.5) * (index + 1);
            
            icon.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${offsetX * 0.2}deg)`;
        });
    });
    
    // Анимация кнопок при наведении
    const buttons = document.querySelectorAll('.btn-primary, .btn-load-more');
    buttons.forEach(button => {
        button.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px) scale(1.05)';
        });
        
        button.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
    
    // Добавляем функционал для основной кнопки - обновление данных
    const updateButton = document.querySelector('.btn-primary');
    if (updateButton) {
        updateButton.addEventListener('click', async function() {
            // Используем плавную анимацию смены текста
            const originalText = await animateButtonText(this, "Обновление...");
            this.disabled = true;
            
            setTimeout(async () => {
                // Генерируем эффект "нового профита"
                showNewProfitNotification();
                
                // Плавно возвращаем исходный текст
                await animateButtonText(this, originalText);
                this.disabled = false;
            }, 1500);
        });
    }
});

// Функция для создания конфетти (денег) при клике на логотип
document.addEventListener('DOMContentLoaded', function() {
    const logo = document.querySelector('.logo');
    
    if (logo) {
        logo.addEventListener('click', function(e) {
            createMoneyConfetti(e.clientX, e.clientY);
        });
    }
});

// Функция для создания конфетти в виде денежных знаков
function createMoneyConfetti(x, y) {
    const colors = ['#7cc373', '#408d3d', '#53c565', '#86d79c', '#9fdb93', '#ffd700'];
    const confettiCount = 50;
    const moneySymbols = ['💰', '💵', '💸', '💲', '🪙', '₽'];
    
    for (let i = 0; i < confettiCount; i++) {
        const useSymbol = Math.random() > 0.7; // 30% шанс на символ вместо обычного конфетти
        
        if (useSymbol) {
            // Создаем денежный символ
            const money = document.createElement('div');
            money.style.position = 'fixed';
            money.style.left = x + 'px';
            money.style.top = y + 'px';
            money.style.fontSize = Math.random() * 20 + 14 + 'px';
            money.style.pointerEvents = 'none';
            money.style.zIndex = '1000';
            money.textContent = moneySymbols[Math.floor(Math.random() * moneySymbols.length)];
            
            document.body.appendChild(money);
            
            const angle = Math.random() * Math.PI * 2;
            const velocity = Math.random() * 4 + 2;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            // Анимация денежного символа
            let posX = x;
            let posY = y;
            let opacity = 1;
            let rotation = Math.random() * 360;
            
            const animate = () => {
                posX += vx;
                posY += vy + 1; // Гравитация
                opacity -= 0.01;
                rotation += Math.random() * 5;
                
                money.style.left = posX + 'px';
                money.style.top = posY + 'px';
                money.style.opacity = opacity;
                money.style.transform = `rotate(${rotation}deg)`;
                
                if (opacity > 0) {
                    requestAnimationFrame(animate);
                } else {
                    document.body.removeChild(money);
                }
            };
            
            setTimeout(() => requestAnimationFrame(animate), i * 20);
        } else {
            // Обычное конфетти
            const confetti = document.createElement('div');
            confetti.style.position = 'fixed';
            confetti.style.left = x + 'px';
            confetti.style.top = y + 'px';
            confetti.style.width = Math.random() * 10 + 5 + 'px';
            confetti.style.height = Math.random() * 10 + 5 + 'px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            confetti.style.pointerEvents = 'none';
            confetti.style.zIndex = '1000';
            
            document.body.appendChild(confetti);
            
            const angle = Math.random() * Math.PI * 2;
            const velocity = Math.random() * 5 + 3;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            // Анимация конфетти
            let posX = x;
            let posY = y;
            let opacity = 1;
            let scale = 1;
            let rotation = Math.random() * 360;
            
            const animate = () => {
                posX += vx;
                posY += vy + 1; // Гравитация
                opacity -= 0.01;
                scale -= 0.003;
                rotation += Math.random() * 5;
                
                confetti.style.left = posX + 'px';
                confetti.style.top = posY + 'px';
                confetti.style.opacity = opacity;
                confetti.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
                
                if (opacity > 0) {
                    requestAnimationFrame(animate);
                } else {
                    document.body.removeChild(confetti);
                }
            };
            
            setTimeout(() => requestAnimationFrame(animate), i * 20);
        }
    }
}

// Обновляем интерфейс в зависимости от роли пользователя
function updateUIBasedOnRole() {
    const adminElements = document.querySelectorAll('.admin-only');
    
    if (isAdmin) {
        // Показываем элементы для администраторов
        adminElements.forEach(el => {
            el.style.display = 'block';
        });
    } else {
        // Скрываем элементы для обычных пользователей
        adminElements.forEach(el => {
            el.style.display = 'none';
        });
    }
}

// Инициализация обработчиков модального окна
function initModalHandlers() {
    const addProfitBtn = document.getElementById('add-profit-btn');
    const modal = document.getElementById('add-profit-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const form = document.getElementById('add-profit-form');
    
    // Инициализируем простые эффекты для модального окна
    if (modal) {
        addSimpleModalEffects(modal);
    }
    
    if (addProfitBtn) {
        addProfitBtn.addEventListener('click', () => {
            openModal(modal);
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal(modal);
        });
    }

    // Закрытие модального окна при клике вне его, но не блокируем прокрутку внутри
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal(modal);
        }
    });
    
    // Предотвращаем закрытие при прокрутке внутри modal-container
    const modalContainer = modal.querySelector('.modal-container');
    if (modalContainer) {
        modalContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal(modal);
        }
    });    // Добавляем современные эффекты к полям формы
    const inputs = modal.querySelectorAll('input, select');
    inputs.forEach(input => {
        addModernInputEffects(input);
    });
    
    // Обработка отправки формы с современными эффектами
    // Добавляем автоформатирование для поля суммы
    const amountInput = document.getElementById('deposit-amount');
    if (amountInput) {
        // Форматируем при вводе
        amountInput.addEventListener('input', function(e) {
            let value = e.target.value;
            
            // Удаляем все кроме цифр, точек и запятых
            value = value.replace(/[^\d.,]/g, '');
            
            // Применяем форматирование только если пользователь не редактирует дробную часть
            if (!value.includes(',') || !e.target.selectionStart || e.target.selectionStart <= value.indexOf(',')) {
                // Парсим и форматируем
                const parsed = parseAmount(value);
                if (parsed > 0) {
                    // Форматируем обратно, но не во время ввода дробной части
                    const formatted = formatNumber(parsed);
                    if (formatted !== value && !value.endsWith(',')) {
                        e.target.value = formatted;
                    }
                }
            }
        });
        
        // Форматируем при потере фокуса
        amountInput.addEventListener('blur', function(e) {
            const value = e.target.value;
            if (value) {
                const parsed = parseAmount(value);
                if (parsed > 0) {
                    e.target.value = formatNumber(parsed);
                }
            }
        });
    }

    if (form) {
        // Добавляем обработчик изменения username для автоматического получения данных
        const usernameInput = document.getElementById('worker-username');
        const workerStatus = document.getElementById('telegram-worker-status');
        
        let usernameTimeout;
        
        if (usernameInput && workerStatus) {
            usernameInput.addEventListener('input', function(e) {
                const username = e.target.value.trim().replace('@', '');
                
                // Очищаем предыдущий таймер
                clearTimeout(usernameTimeout);
                
                // Скрываем статус если поле пустое
                if (!username) {
                    workerStatus.style.display = 'none';
                    return;
                }
                
                // Устанавливаем таймер для предотвращения слишком частых запросов
                usernameTimeout = setTimeout(async () => {
                    try {
                        // Показываем статус загрузки
                        workerStatus.className = 'telegram-worker-status loading';
                        workerStatus.innerHTML = '🔄 Получаем данные пользователя...';
                        
                        // Получаем данные пользователя и добавляем в базу
                        const result = await addWorkerWithTelegramData(username);
                        
                        if (result.success && result.user_info) {
                            const userInfo = result.user_info;
                            let statusText = '';
                            let statusClass = '';
                            
                            if (userInfo.source === 'telegram_webapp') {
                                statusText = `✅ ${userInfo.first_name} (ID: ${userInfo.id}) - данные получены из Telegram`;
                                statusClass = 'success';
                            } else if (userInfo.source === 'webapp_fallback') {
                                statusText = `⚠️ ${userInfo.first_name} - использованы базовые данные (нет в WebApp)`;
                                statusClass = 'info';
                            } else {
                                statusText = `📝 ${userInfo.first_name} - данные по умолчанию`;
                                statusClass = 'info';
                            }
                            
                            workerStatus.className = `telegram-worker-status ${statusClass}`;
                            workerStatus.innerHTML = statusText;
                            
                            // Если данные добавлены/обновлены в базе
                            if (result.data && result.data.action) {
                                if (result.data.action === 'found_existing') {
                                    workerStatus.innerHTML = `🔄 Найден существующий пользователь: ${result.data.worker.username}`;
                                    if (result.data.worker.username !== username) {
                                        workerStatus.innerHTML += ` (вместо ${username})`;
                                        // Опционально: автоматически обновить поле input
                                        usernameInput.value = result.data.worker.username;
                                    }
                                } else {
                                    const actionText = result.data.action === 'added' ? 'добавлен' : 
                                                     result.data.action === 'updated' ? 'обновлён' : 
                                                     result.data.action === 'no_changes' ? 'найден' : 'обработан';
                                    workerStatus.innerHTML += ` (${actionText} в базе)`;
                                }
                            }
                            
                        } else {
                            workerStatus.className = 'telegram-worker-status error';
                            workerStatus.innerHTML = `❌ Ошибка: ${result.error || 'Не удалось получить данные пользователя'}`;
                        }
                        
                    } catch (error) {
                        console.error('Ошибка при получении данных пользователя:', error);
                        workerStatus.className = 'telegram-worker-status error';
                        workerStatus.innerHTML = `❌ Ошибка при получении данных: ${error.message}`;
                    }
                }, 1000); // Задержка 1 секунда после окончания ввода
            });
        }
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = form.querySelector('.btn-submit');
            const depositAmountRaw = document.getElementById('deposit-amount').value;
            const workerPercent = document.getElementById('worker-percent').value;
            const service = document.getElementById('service-select').value;
            const workerUsername = document.getElementById('worker-username').value;
            
            // Проверка заполнения формы
            if (!depositAmountRaw || !workerPercent || !service || !workerUsername) {
                showNotification('Пожалуйста, заполните все поля формы!', 'warning');
                highlightEmptyFields(form);
                return;
            }
            
            // Парсим сумму с учетом форматирования (точки как разделители тысяч, запятая как десятичный разделитель)
            const depositAmount = parseAmount(depositAmountRaw);
            
            if (depositAmount <= 0) {
                showNotification('Сумма должна быть больше нуля!', 'warning');
                document.getElementById('deposit-amount').focus();
                return;
            }
            
            // Показываем состояние загрузки
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
            
            try {
                // Убираем @ если есть
                const cleanUsername = workerUsername.startsWith('@') ? workerUsername.substring(1) : workerUsername;
                
                // Отправляем данные на API сервер
                const response = await fetch('http://127.0.0.1:5000/api/profits', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        amount: depositAmount,
                        worker_percent: parseInt(workerPercent),
                        service: service,
                        worker_username: cleanUsername,
                        added_by: tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : null,
                        auto_fetch_telegram: false // Отключаем автоматическое получение через бота, так как мы уже получили через WebApp
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.success) {
                    // Обновляем статистику проекта
                    projectStats.totalAmount = result.total_amount;
                    projectStats.profitsCount = result.profits_count;
                    updateStatistics(projectStats);
                    
                    // Перезагружаем данные профитов
                    await fetchProjectData();
                    
                    // Показываем уведомление об успехе
                    let successMessage = 'Профит успешно добавлен в базу данных!';
                    if (result.telegram_info) {
                        successMessage += ` ${result.telegram_info}`;
                    }
                    showNotification(successMessage, 'success');
                    
                    // Закрываем модальное окно
                    closeModal(modal);
                    
                    // Очищаем форму
                    form.reset();
                    document.getElementById('worker-percent').value = '70'; // возвращаем значение по умолчанию
                    
                    // Скрываем статус воркера
                    if (workerStatus) {
                        workerStatus.style.display = 'none';
                    }
                } else {
                    throw new Error(result.error || 'Неизвестная ошибка');
                }
                
            } catch (error) {
                console.error('Ошибка при добавлении профита:', error);
                showNotification('Ошибка при добавлении профита: ' + error.message, 'error');
            }
            
            // Убираем состояние загрузки
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        });
    }
}

// Функция для показа уведомления с управлением наложением
let notificationQueue = [];
let activeNotifications = [];

function showNotification(message, type = 'info') {
    // Удаляем предыдущие уведомления того же типа
    activeNotifications.forEach(notif => {
        if (notif.classList.contains(type)) {
            hideNotification(notif);
        }
    });
    
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = 'notification ' + type;
    
    // Определяем иконку в зависимости от типа уведомления
    let iconName = 'info-circle';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'exclamation-circle';
    if (type === 'warning') iconName = 'exclamation-triangle';
    
    notification.innerHTML = `
        <i class="fas fa-${iconName}"></i>
        <p>${message}</p>
    `;
    
    // Стили для уведомления
    notification.style.position = 'fixed';
    notification.style.top = `${30 + activeNotifications.length * 80}px`;
    notification.style.right = '-300px';
    notification.style.backgroundColor = 'var(--color-primary)';
    notification.style.color = '#fff';
    notification.style.padding = '15px 20px';
    notification.style.borderRadius = '8px';
    notification.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.2)';
    notification.style.display = 'flex';
    notification.style.alignItems = 'center';
    notification.style.gap = '10px';
    notification.style.zIndex = '9999';
    notification.style.transition = 'all 0.5s ease-in-out';
    notification.style.maxWidth = '300px';
    notification.style.minWidth = '200px';
    
    // Меняем цвет в зависимости от типа
    if (type === 'success') {
        notification.style.backgroundColor = '#28a745';
    } else if (type === 'error') {
        notification.style.backgroundColor = '#dc3545';
    } else if (type === 'warning') {
        notification.style.backgroundColor = '#ffc107';
        notification.style.color = '#333';
    }
    
    // Добавляем в DOM
    document.body.appendChild(notification);
    activeNotifications.push(notification);
    
    // Анимируем появление
    setTimeout(() => {
        notification.style.right = '30px';
    }, 100);
    
    // Автоматически скрываем через 5 секунд
    setTimeout(() => {
        hideNotification(notification);
    }, 5000);
}

function hideNotification(notification) {
    if (!notification.parentNode) return;
    
    notification.style.right = '-300px';
    
    // Удаляем из списка активных
    const index = activeNotifications.indexOf(notification);
    if (index > -1) {
        activeNotifications.splice(index, 1);
    }
    
    // Перестраиваем позиции оставшихся уведомлений
    activeNotifications.forEach((notif, i) => {
        notif.style.top = `${30 + i * 80}px`;
    });
    
    // Удаляем из DOM после завершения анимации
    setTimeout(() => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    }, 500);
}

// Функция для показа уведомления о новом профите
function showNewProfitNotification(profit) {
    const container = document.querySelector('.profit-container');
    if (container) {
        const card = document.createElement('div');
        card.className = 'profit-card';
        
        // Форматируем дату
        let dateStr = '';
        if (profit.date) {
            const date = new Date(profit.date);
            dateStr = date.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        // Форматирование воркера
        let workerDisplay = profit.worker;
        if (workerDisplay.startsWith('@')) {
            workerDisplay = workerDisplay.substring(1);
        }
        
        card.innerHTML = `
            <div class="profit-header">
                <i class="fas fa-trophy"></i>
                <h3>🎉 Успешная мамонтизация!</h3>
            </div>
            <div class="profit-info">
                <p><i class="fas fa-money-bill-wave"></i> 💰 Сумма депа: <span class="profit-amount">${formatNumber(profit.amount)}₽</span></p>
                <p><i class="fas fa-percentage"></i> 🛍 Процент воркера: <span class="profit-amount">${profit.workerPercent}</span></p>
                <p><i class="fas fa-store"></i> 💻 Сервис: <span class="profit-service">${profit.service}</span></p>
                <p><i class="fas fa-user"></i> 👼 Воркер: <span class="profit-worker">${profit.worker}</span></p>
                ${dateStr ? `<p><i class="fas fa-calendar"></i> 📅 Дата: <span class="profit-date">${dateStr}</span></p>` : ''}
            </div>
            <div class="profit-project">
                <span class="project-name">💵 Касса проекта:</span>
                <span class="project-amount">${formatNumber(profit.projectAmount)}₽</span>
            </div>
        `;
        
        // Вставляем новую карточку в начало списка
        container.insertBefore(card, container.firstChild);
        
        // Анимируем появление
        setTimeout(() => {
            card.style.transition = `opacity 0.5s ease-in-out, transform 0.5s ease-in-out`;
            card.classList.add('show');
            
            // Добавляем эффект нового элемента для новых карточек
            if (isNew) {
                card.style.boxShadow = '0 0 20px var(--color-gold)';
                setTimeout(() => {
                    card.style.boxShadow = '';
                }, 3000);
            }
        }, delay * 200);
    };
}

// Обновляем счетчики после добавления нового профита
function updateCounters(profit) {
    // Обновляем общую кассу
    const totalAmount = document.querySelector('.counter[data-target="34463"]');
    if (totalAmount) {
        const currentValue = parseInt(totalAmount.textContent.replace(/,/g, ''));
        const newValue = currentValue + parseFloat(profit.amount.replace(/[,.]/g, ''));
        totalAmount.setAttribute('data-target', newValue);
        totalAmount.textContent = newValue.toLocaleString();
    }
    
    // Обновляем количество успешных профитов
    const totalProfits = document.querySelector('.counter[data-target="156"]');
    if (totalProfits) {
        const currentValue = parseInt(totalProfits.textContent);
        const newValue = currentValue + 1;
        totalProfits.setAttribute('data-target', newValue);
        totalProfits.textContent = newValue;
    }
}


// === ФУНКЦИИ УПРАВЛЕНИЯ МОДАЛЬНЫМИ ОКНАМИ ===

// Переменная для хранения позиции скролла
let scrollPosition = 0;

// Функция для открытия модального окна с блокировкой фона
function openModal(modal) {
    // Запоминаем текущую позицию прокрутки
    scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    
    // Блокируем прокрутку фона с помощью CSS класса и стилей
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollPosition}px`;
    
    // Дополнительная блокировка для разных браузеров
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.position = 'fixed';
    document.documentElement.style.width = '100%';
    document.documentElement.style.height = '100%';
    
    // Блокируем touch события на overlay для предотвращения прокрутки
    const overlay = modal;
    if (overlay) {
        overlay.addEventListener('touchmove', preventScroll, { passive: false });
        overlay.addEventListener('wheel', preventScroll, { passive: false });
    }
    
    // Открываем модальное окно
    modal.classList.add('active');
    
    // Добавляем фокус на первое поле с задержкой для плавной анимации
    setTimeout(() => {
        const firstInput = modal.querySelector('input');
        if (firstInput) firstInput.focus();
    }, 400);
}

// Функция для закрытия модального окна с разблокировкой фона
function closeModal(modal) {
    const container = modal.querySelector('.modal-container');
    
    // Добавляем анимацию закрытия
    if (container) {
        container.style.animation = 'modalSlideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
    }
    
    setTimeout(() => {
        modal.classList.remove('active');
        if (container) {
            container.style.animation = '';
        }
        
        // Убираем блокировку touch событий
        const overlay = modal;
        if (overlay) {
            overlay.removeEventListener('touchmove', preventScroll);
            overlay.removeEventListener('wheel', preventScroll);
        }
        
        // Разблокируем прокрутку фона и восстанавливаем позицию
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        
        // Восстанавливаем стили документа
        document.documentElement.style.overflow = '';
        document.documentElement.style.position = '';
        document.documentElement.style.width = '';
        document.documentElement.style.height = '';
        
        // Восстанавливаем позицию прокрутки
        window.scrollTo(0, scrollPosition);
    }, 300);
}

// Функция для предотвращения прокрутки
function preventScroll(e) {
    // Разрешаем прокрутку только внутри modal-container
    const modalContainer = e.target.closest('.modal-container');
    if (!modalContainer) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
}

// Функция для плавного закрытия модального окна (оставляем для совместимости)
function closeModalWithAnimation(modal) {
    closeModal(modal);
}

// CSS анимация для закрытия (добавляется динамически)
const modalSlideOutCSS = `
@keyframes modalSlideOut {
    0% {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
    }
    100% {
        opacity: 0;
        transform: translateY(30px) scale(0.95);
        filter: blur(3px);
    }
}
`;

// Добавляем стили в head
if (!document.querySelector('#modal-animations')) {
    const style = document.createElement('style');
    style.id = 'modal-animations';
    style.textContent = modalSlideOutCSS;
    document.head.appendChild(style);
}

// Функция для добавления современных эффектов к полям ввода
function addModernInputEffects(input) {
    // Эффект фокуса
    input.addEventListener('focus', function() {
        this.parentElement.classList.add('focused');
        
        // Добавляем рябь при фокусе
        createRippleEffect(this, 'focus');
    });
    
    input.addEventListener('blur', function() {
        this.parentElement.classList.remove('focused');
    });
    
    // Валидация в реальном времени
    input.addEventListener('input', function() {
        validateField(this);
    });
    
    // Эффект при клике
    input.addEventListener('click', function(e) {
        createRippleEffect(this, 'click', e);
    });
}

// Функция для создания эффекта ряби
function createRippleEffect(element, type, event = null) {
    const ripple = document.createElement('div');
    ripple.style.position = 'absolute';
    ripple.style.borderRadius = '50%';
    ripple.style.transform = 'scale(0)';
    ripple.style.animation = 'rippleAnimation 0.6s linear';
    ripple.style.pointerEvents = 'none';
    
    if (type === 'focus') {
        ripple.style.backgroundColor = 'rgba(64, 141, 61, 0.3)';
        ripple.style.width = '20px';
        ripple.style.height = '20px';
        ripple.style.top = '10px';
        ripple.style.left = '10px';
    } else if (type === 'click' && event) {
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = event.clientX - rect.left - size / 2 + 'px';
        ripple.style.top = event.clientY - rect.top - size / 2 + 'px';
        ripple.style.backgroundColor = 'rgba(64, 141, 61, 0.2)';
    }
    
    element.style.position = 'relative';
    element.appendChild(ripple);
    
    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Функция для валидации полей
function validateField(field) {
    const value = field.value.trim();
    const fieldType = field.type;
    const isValid = checkFieldValidity(field, value, fieldType);
    
    field.classList.toggle('valid', isValid);
    field.classList.toggle('invalid', !isValid);
    
    return isValid;
}

// Проверка валидности поля
function checkFieldValidity(field, value, type) {
    if (!value) return false;
    
    switch (type) {
        case 'number':
            return !isNaN(value) && parseFloat(value) > 0;
        case 'text':
            return value.length >= 2;
        default:
            return true;
    }
}

// Функция для подсветки пустых полей
function highlightEmptyFields(form) {
    const inputs = form.querySelectorAll('input[required], select[required]');
    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('error-highlight');
            input.addEventListener('input', function removeHighlight() {
                this.classList.remove('error-highlight');
                this.removeEventListener('input', removeHighlight);
            });
        }
    });
}

// Улучшенная функция уведомлений с современными эффектами
function showModernNotification(message, type = 'info', duration = 4000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type} modern-notification`;
    
    const iconMap = {
        'info': 'info-circle',
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'warning': 'exclamation-triangle'
    };
    
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fas fa-${iconMap[type]}"></i>
        </div>
        <div class="notification-content">
            <p>${message}</p>
        </div>
        <div class="notification-close">
            <i class="fas fa-times"></i>
        </div>
    `;
    
    // Добавляем стили
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '-350px',
        maxWidth: '320px',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 100%)',
        backdropFilter: 'blur(15px)',
        WebkitBackdropFilter: 'blur(15px)',
        borderRadius: '16px',
        padding: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.2)',
        border: '1px solid rgba(255,255,255,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: '10000',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
    });
    
    document.body.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => {
        notification.style.right = '20px';
    }, 100);
    
    // Обработчик закрытия
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        hideNotification(notification);
    });
    
    // Автоматическое скрытие
    setTimeout(() => {
        if (notification.parentNode) {
            hideNotification(notification);
        }
    }, duration);
}

function hideNotification(notification) {
    notification.style.right = '-350px';
    notification.style.opacity = '0';
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 400);
}

// Обновляем счетчики после добавления нового профита
function updateCounters(profit) {
    // Обновляем общую кассу
    const totalAmount = document.querySelector('.counter[data-target="34463"]');
    if (totalAmount) {
        const currentValue = parseInt(totalAmount.getAttribute('data-target'));
        const newValue = currentValue + parseFloat(profit.amount);
        totalAmount.setAttribute('data-target', newValue.toString());
        totalAmount.textContent = newValue.toLocaleString();
    }
    
    // Обновляем количество успешных профитов
    const totalProfits = document.querySelector('.counter[data-target="156"]');
    if (totalProfits) {
        const currentValue = parseInt(totalProfits.getAttribute('data-target'));
        const newValue = currentValue + 1;
        totalProfits.setAttribute('data-target', newValue.toString());
        totalProfits.textContent = newValue.toLocaleString();
    }
}

// === СОВРЕМЕННЫЕ ИНТЕРАКТИВНЫЕ ЭФФЕКТЫ ===

// Параллакс эффект для фоновых элементов
document.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX / window.innerWidth;
    const mouseY = e.clientY / window.innerHeight;
    
    // Анимируем фоновые blob элементы
    const blobs = document.querySelectorAll('.hero-blob');
    blobs.forEach((blob, index) => {
        const speed = 0.5 + (index * 0.2);
        const x = (mouseX - 0.5) * speed * 50;
        const y = (mouseY - 0.5) * speed * 50;
        blob.style.transform = `translate(${x}px, ${y}px) rotate(${x * 0.5}deg)`;
    });
    
    // Анимируем частицы в hero секции
    const particles = document.querySelectorAll('.hero-particle');
    particles.forEach((particle, index) => {
        const speed = 0.3 + (index * 0.1);
        const x = (mouseX - 0.5) * speed * 30;
        const y = (mouseY - 0.5) * speed * 30;
        particle.style.transform = `translate(${x}px, ${y}px)`;
    });
});

// Добавление ripple эффекта к кнопкам
document.querySelectorAll('button, .btn').forEach(button => {
    button.addEventListener('click', function(e) {
        // Создаем ripple элемент
        const ripple = document.createElement('span');
        ripple.classList.add('ripple-effect');
        
        // Получаем размеры кнопки
        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        // Позиционируем ripple
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        // Добавляем стили для анимации
        ripple.style.cssText += `
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.6);
            pointer-events: none;
            transform: scale(0);
            animation: rippleAnimation 0.6s ease-out forwards;
        `;
        
        // Добавляем к кнопке
        this.style.position = 'relative';
        this.style.overflow = 'hidden';
        this.appendChild(ripple);
        
        // Удаляем после анимации
        setTimeout(() => {
            if (ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 600);
    });
});

// Плавная анимация появления элементов при скролле
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-visible');
            // Добавляем задержку для последовательной анимации карточек
            if (entry.target.classList.contains('profit-card')) {
                const delay = Array.from(entry.target.parentNode.children).indexOf(entry.target) * 100;
                entry.target.style.animationDelay = `${delay}ms`;
            }
        }
    });
}, observerOptions);

// Наблюдаем за элементами для анимации
document.querySelectorAll('.profit-card, .hero-content, .stat-item').forEach(el => {
    el.classList.add('fade-in-element');
    observer.observe(el);
});

// Добавляем CSS для fade-in анимации
const style = document.createElement('style');
style.textContent = `
    .fade-in-element {
        opacity: 0;
        transform: translateY(30px);
        transition: all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }
    
    .fade-in-visible {
        opacity: 1;
        transform: translateY(0);
    }
    
    @keyframes rippleAnimation {
        to {
            transform: scale(2);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Добавляем современные микроинтеракции
document.querySelectorAll('.profit-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        // Добавляем subtle тень и поднимаем карточку
        this.style.transform = 'translateY(-8px) rotateX(5deg)';
        this.style.boxShadow = '0 20px 40px rgba(64, 141, 61, 0.2)';
    });
    
    card.addEventListener('mouseleave', function() {
        // Возвращаем в исходное состояние
        this.style.transform = 'translateY(0) rotateX(0)';
        this.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.08)';
    });
});

// Добавляем эффект печатной машинки для заголовков
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Инициализируем typewriter эффект для главного заголовка при загрузке
window.addEventListener('load', () => {
    const mainTitle = document.querySelector('.hero-title');
    if (mainTitle) {
        const originalText = mainTitle.textContent;
        setTimeout(() => {
            typeWriter(mainTitle, originalText, 80);
        }, 1000);
    }
});

console.log('🎉 Современные интерактивные эффекты инициализированы!');

// === УЛУЧШЕННЫЕ АНИМАЦИИ КНОПОК ===

// Функция для анимации смены текста кнопки
function animateButtonText(button, newText, duration = 400) {
    return new Promise((resolve) => {
        const originalText = button.innerHTML;
        
        // Фаза исчезновения
        button.style.transition = `all ${duration / 2}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        button.style.opacity = '0';
        button.style.transform = 'translateY(-5px) scale(0.98)';
        
        setTimeout(() => {
            // Меняем текст
            button.innerHTML = newText;
            
            // Фаза появления
            button.style.opacity = '1';
            button.style.transform = 'translateY(0) scale(1)';
            
            setTimeout(() => {
                button.style.transition = '';
                resolve(originalText);
            }, duration / 2);
            
        }, duration / 2);
    });
}

// Применяем улучшенную анимацию ко всем кнопкам
document.querySelectorAll('button, .btn').forEach(button => {
    if (!button.classList.contains('btn-load-more')) {
        button.addEventListener('click', function(e) {
            // Добавляем subtle анимацию нажатия
            this.style.transition = 'all 0.15s ease';
            this.style.transform = 'scale(0.95)';
            
            setTimeout(() => {
                this.style.transform = 'scale(1)';
                setTimeout(() => {
                    this.style.transition = '';
                }, 150);
            }, 150);
        });
    }
});

// Инициализация плавных переходов для фильтров
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // Анимация смены активного состояния
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        });
        
        // Добавляем задержку для визуального эффекта
        setTimeout(() => {
            this.classList.add('active');
            document.querySelectorAll('.filter-btn').forEach(b => {
                if (b !== this) b.classList.remove('active');
            });
        }, 100);
    });
});

// Простые эффекты для модального окна (встроенные)
function addSimpleModalEffects(modal) {
    // Добавляем простые визуальные эффекты без сложной системы частиц
    const inputs = modal.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.style.transform = 'translateY(-2px) scale(1.01)';
            this.style.boxShadow = '0 0 0 4px rgba(64, 141, 61, 0.15), 0 8px 16px rgba(0, 0, 0, 0.1)';
        });
        
        input.addEventListener('blur', function() {
            this.style.transform = '';
            this.style.boxShadow = '';
        });
        
        input.addEventListener('input', function() {
            if (this.value.length > 0) {
                this.style.borderColor = 'var(--color-primary)';
            } else {
                this.style.borderColor = '';
            }
        });
    });
}

console.log('✨ Улучшенные анимации кнопок активированы!');

// === НАВИГАЦИОННАЯ СИСТЕМА ===

// Инициализация навигации
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
});

function initializeNavigation() {
    const menuItems = document.querySelectorAll('.menu a');
    
    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Определяем раздел по тексту ссылки
            const text = this.textContent.trim();
            let sectionName = '';
            
            if (text.includes('Профиты')) {
                sectionName = 'profits';
            } else if (text.includes('Статистика')) {
                sectionName = 'statistics';
            } else if (text.includes('Воркеры')) {
                sectionName = 'workers';
            } else if (text.includes('Администрирование')) {
                sectionName = 'admin';
            }
            
            if (sectionName) {
                switchToSection(sectionName);
                updateActiveMenuItem(this);
            }
        });
    });
}

function switchToSection(sectionName) {
    // Скрываем все разделы
    const sections = document.querySelectorAll('#profits-section, #statistics-section, #workers-section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Показываем нужный раздел
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.style.display = 'block';
        
        // Добавляем анимацию появления
        targetSection.style.opacity = '0';
        targetSection.style.transform = 'translateY(20px)';
        
        requestAnimationFrame(() => {
            targetSection.style.transition = 'all 0.5s ease-out';
            targetSection.style.opacity = '1';
            targetSection.style.transform = 'translateY(0)';
        });
        
        // Загружаем данные для раздела
        loadSectionData(sectionName);
        
        // Добавляем анимацию элементам внутри раздела
        setTimeout(() => {
            const cards = targetSection.querySelectorAll('.stat-card, .worker-card, .service-item');
            cards.forEach((card, index) => {
                card.classList.add('fade-in-up');
                card.style.animationDelay = `${index * 0.1}s`;
            });
        }, 100);
    }
}

function updateActiveMenuItem(activeItem) {
    // Убираем активный класс со всех пунктов меню
    const menuItems = document.querySelectorAll('.menu a');
    menuItems.forEach(item => item.classList.remove('active'));
    
    // Добавляем активный класс к выбранному пункту
    activeItem.classList.add('active');
}

async function loadSectionData(sectionName) {
    try {
        // Показываем индикатор загрузки
        showLoadingIndicator(sectionName);
        
        if (sectionName === 'statistics') {
            await loadStatisticsData();
        } else if (sectionName === 'workers') {
            await loadWorkersData();
        }
        // Для раздела profits данные уже загружаются в существующем коде
        
        // Скрываем индикатор загрузки
        hideLoadingIndicator(sectionName);
    } catch (error) {
        console.error(`Error loading ${sectionName} data:`, error);
        hideLoadingIndicator(sectionName);
        showNotification(`Ошибка загрузки данных для раздела ${sectionName}: ${error.message}`, 'error');
    }
}

function showLoadingIndicator(sectionName) {
    const section = document.getElementById(`${sectionName}-section`);
    if (!section) return;
    
    // Создаем индикатор загрузки если его нет
    let loader = section.querySelector('.section-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.className = 'section-loader';
        loader.innerHTML = `
            <div class="loader-spinner"></div>
            <p>Загрузка данных...</p>
        `;
        loader.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 100;
        `;
        section.style.position = 'relative';
        section.appendChild(loader);
    }
    
    loader.style.display = 'block';
}

function hideLoadingIndicator(sectionName) {
    const section = document.getElementById(`${sectionName}-section`);
    if (!section) return;
    
    const loader = section.querySelector('.section-loader');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Загрузка данных статистики
async function loadStatisticsData() {
    try {
        const response = await fetch('http://127.0.0.1:5000/api/data');
        const data = await response.json();
        
        if (response.ok) {
            updateDetailedStatistics(data);
            updateServicesStatistics(data.profits);
        } else {
            throw new Error(data.error || 'Failed to load statistics');
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
        showNotification('Ошибка загрузки статистики: ' + error.message, 'error');
    }
}

function updateDetailedStatistics(data) {
    // Обновляем основные показатели
    document.getElementById('total-amount-detailed').textContent = 
        formatNumber(data.total_amount) + ' ₽';
    document.getElementById('total-profits-detailed').textContent = 
        data.profits_count.toString();
    document.getElementById('active-workers-detailed').textContent = 
        data.workers_count.toString();
    
    // Считаем средний профит
    const avgProfit = data.profits_count > 0 ? data.total_amount / data.profits_count : 0;
    document.getElementById('average-profit').textContent = 
        formatNumberWithDecimals(avgProfit, 3) + ' ₽';
    
    // Можно добавить логику для подсчета профитов за сегодня
    // Пока оставляем заглушки
    const statChanges = document.querySelectorAll('.stat-change');
    if (statChanges.length >= 2) {
        // Здесь можно добавить логику подсчета изменений за день
        statChanges[0].textContent = `Общий доход проекта`;
        statChanges[1].textContent = `Успешных сделок`;
    }
}

function updateServicesStatistics(profits) {
    const servicesContainer = document.getElementById('services-stats');
    if (!servicesContainer) return;
    
    // Группируем профиты по сервисам
    const serviceStats = {};
    profits.forEach(profit => {
        const service = profit.service || 'Не указан';
        if (!serviceStats[service]) {
            serviceStats[service] = {
                count: 0,
                totalAmount: 0
            };
        }
        serviceStats[service].count++;
        serviceStats[service].totalAmount += profit.amount;
    });
    
    // Получаем иконки для сервисов
    const serviceIcons = {
        'MarketPlace': 'fas fa-shopping-cart',
        'BankApp': 'fas fa-university',
        'CryptoEx': 'fab fa-bitcoin',
        'WalletPay': 'fas fa-wallet',
        'FiatGate': 'fas fa-exchange-alt'
    };
    
    // Генерируем HTML для каждого сервиса
    const servicesHtml = Object.entries(serviceStats)
        .sort(([,a], [,b]) => b.totalAmount - a.totalAmount)
        .map(([service, stats]) => `
            <div class="service-item">
                <div class="service-info">
                    <div class="service-icon">
                        <i class="${serviceIcons[service] || 'fas fa-cog'}"></i>
                    </div>
                    <div class="service-details">
                        <h4>${service}</h4>
                        <p>${stats.count} профитов</p>
                    </div>
                </div>
                <div class="service-amount">
                    ${formatNumber(stats.totalAmount)} ₽
                </div>
            </div>
        `).join('');
    
    servicesContainer.innerHTML = servicesHtml;
}

// Загрузка данных о воркерах
async function loadWorkersData() {
    try {
        // Загружаем данные о воркерах и профитах параллельно
        const [workersResponse, profitsResponse] = await Promise.all([
            fetch('http://127.0.0.1:5000/api/workers'),
            fetch('http://127.0.0.1:5000/api/profits')
        ]);
        
        const workersData = await workersResponse.json();
        const profitsData = await profitsResponse.json();
        
        if (workersResponse.ok && profitsResponse.ok) {
            displayWorkers(workersData.workers, profitsData.profits);
        } else {
            throw new Error(workersData.error || profitsData.error || 'Failed to load workers');
        }
    } catch (error) {
        console.error('Error loading workers:', error);
        showNotification('Ошибка загрузки данных о воркерах: ' + error.message, 'error');
    }
}

function displayWorkers(workers, profits = []) {
    const workersContainer = document.querySelector('.workers-container');
    if (!workersContainer) return;
    
    // Получаем статистику профитов для каждого воркера из полученных данных
    const workerStats = getWorkerStatisticsFromProfits(profits);
    
    const workersHtml = workers.map(worker => {
        // Ищем статистику по username воркера
        const stats = workerStats[worker.username] || { count: 0, totalAmount: 0 };
        const initials = getInitials(worker.name || worker.username);
        const status = worker.telegram_id && worker.telegram_id.trim() ? 'active' : 'inactive';
        const statusText = status === 'active' ? 'Активен' : 'Не в боте';
        
        return `
            <div class="worker-card fade-in-up">
                <div class="worker-status ${status}">${statusText}</div>
                <div class="worker-header">
                    <div class="worker-avatar">${initials}</div>
                    <div class="worker-info">
                        <h3>${worker.name || worker.username}</h3>
                        <p>@${worker.username}</p>
                        ${worker.register_date ? `<small>Регистрация: ${new Date(worker.register_date).toLocaleDateString('ru-RU')}</small>` : ''}
                    </div>
                </div>
                <div class="worker-stats">
                    <div class="worker-stat">
                        <span class="stat-number">${stats.count}</span>
                        <span class="stat-label">Профитов</span>
                    </div>
                    <div class="worker-stat">
                        <span class="stat-number">${formatNumber(stats.totalAmount)} ₽</span>
                        <span class="stat-label">Общая сумма</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    workersContainer.innerHTML = workersHtml;
}

function getWorkerStatisticsFromProfits(profits) {
    // Собираем статистику из полученных профитов
    const workerStats = {};
    
    console.log('Processing profits for workers:', profits); // Отладка
    
    profits.forEach(profit => {
        // В API данных поле называется worker_name
        const workerName = profit.worker_name || profit.worker || 'unknown';
        
        // Убираем @ из имени воркера, если есть
        const cleanWorkerName = workerName.replace('@', '');
        
        console.log(`Processing profit: worker="${workerName}", clean="${cleanWorkerName}", amount=${profit.amount}`); // Отладка
        
        if (!workerStats[cleanWorkerName]) {
            workerStats[cleanWorkerName] = { count: 0, totalAmount: 0 };
        }
        workerStats[cleanWorkerName].count++;
        workerStats[cleanWorkerName].totalAmount += (profit.amount || 0);
    });
    
    console.log('Final worker statistics:', workerStats); // Для отладки
    return workerStats;
}

// Старая функция - оставляем для совместимости с другим кодом
function getWorkerStatistics() {
    // Собираем статистику из уже загруженных профитов
    const workerStats = {};
    
    profitData.forEach(profit => {
        const workerName = profit.worker_name || profit.worker || 'unknown';
        const cleanWorkerName = workerName.replace('@', '');
        
        if (!workerStats[cleanWorkerName]) {
            workerStats[cleanWorkerName] = { count: 0, totalAmount: 0 };
        }
        workerStats[cleanWorkerName].count++;
        workerStats[cleanWorkerName].totalAmount += parseFloat(profit.amount || 0);
    });
    
    return workerStats;
}

function getInitials(name) {
    if (!name) return '?';
    
    // Убираем @ если есть
    const cleanName = name.replace('@', '');
    
    // Разделяем по пробелам и берем первые буквы
    const words = cleanName.split(' ').filter(word => word.length > 0);
    if (words.length === 1) {
        return words[0].substring(0, 2).toUpperCase();
    }
    
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

// Инициализируем навигацию на главном разделе
document.addEventListener('DOMContentLoaded', function() {
    // По умолчанию показываем раздел профитов
    setTimeout(() => {
        switchToSection('profits');
    }, 100);
});

console.log('🚀 Навигационная система инициализирована!');
