# IndieHub Desktop Client (C++)

Нативный клиент в стиле Steam.

### Что умеет сейчас

- Перед запуском окна **проверяет**, доступен ли локальный сервер (`http://localhost/itch-steam-like/`)
- Делает до 3 попыток с небольшой паузой
- Если сервер недоступен — показывает понятное сообщение об ошибке (MessageBox)
- Если всё ок — открывает окно с веб-интерфейсом

---

## Зависимости

Клиент использует библиотеку **webview**:

https://github.com/webview/webview

Она очень лёгкая и использует системный движок:
- Windows → WebView2 (Microsoft Edge)
- macOS → WKWebView
- Linux → WebKitGTK

---

## Сборка на Windows (самый частый случай)

### Вариант 1 — Visual Studio (рекомендуется)

1. Установи **Visual Studio 2022** с компонентом "Разработка классических приложений на C++"
2. Скачай webview:
   ```bash
   git clone https://github.com/webview/webview.git
   ```
3. Создай новый проект "Empty Project" или "Console App"
4. Добавь `main.cpp` в проект
5. В настройках проекта:
   - C/C++ → General → Additional Include Directories → укажи папку с `webview.h`
   - Linker → Input → Additional Dependencies → добавь `winhttp.lib`
6. Собери (x64)

### Вариант 2 — MinGW / g++

```bash
# Скачай webview
git clone https://github.com/webview/webview.git

# Скомпилируй
g++ -std=c++17 main.cpp ^
    -I./webview ^
    -lole32 -lshlwapi -ldwmapi -lwinhttp ^
    -o IndieHub.exe
```

---

## Как пользоваться

1. Запусти **XAMPP** → Apache + MySQL
2. Убедись, что сайт открывается в браузере:
   ```
   http://localhost/itch-steam-like/
   ```
3. Запусти `IndieHub.exe`

Если Apache не запущен или папка лежит не там — клиент сразу покажет понятную ошибку вместо пустого/чёрного окна.

---

## Настройки (в main.cpp)

В самом верху файла можно менять:

```cpp
const std::string TARGET_URL  = "http://localhost/itch-steam-like/";
const std::string TARGET_PATH = "/itch-steam-like/";
const int MAX_RETRIES         = 3;
```

---

## Что можно добавить позже

- Красивый сплэш-скрин пока идёт проверка
- Кнопка "Повторить" в окне ошибки
- Системный трей
- Автозапуск вместе с Windows
- Проверка обновлений клиента
- Запуск скачанных игр прямо из клиента
