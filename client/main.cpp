// CATio - Frameless launcher with custom icons
// Поток: старт -> (сервер лежит? 404 на весь экран : не авторизован? логин на весь экран)
//       -> всплывашка "Авторизация успешна" -> основной интерфейс
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <winhttp.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <shlobj.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include <thread>
#include <atomic>
#include <cstring>

#include "webview/webview.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "version.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "msimg32.lib")

const wchar_t* APP_TITLE = L"CATio";
const char* STORE_URL     = "http://localhost/itch-steam-like/?client=1";
const char* LIBRARY_URL   = "http://localhost/itch-steam-like/?view=library&client=1";
const char* COMMUNITY_URL = "http://localhost/itch-steam-like/?view=community&client=1";
const char* PROFILE_URL   = "http://localhost/itch-steam-like/?view=profile&client=1";
const char* AUTH_URL      = "http://localhost/itch-steam-like/?view=auth&client=1";

// Страница «сервер недоступен». Показывается через set_html() (NavigateToString) —
// без сети, поэтому нативный экран ошибки WebView2 невозможен в принципе.
// Перезагрузка НЕ делается из HTML (никакого meta refresh) — кот тихо проверяет
// сервер из C++ по таймеру (IDT_RETRY) и кнопкой через мост catioRetry().
// Raw-строка с уникальным разделителем HTML: внутренние кавычки не ломают литерал.
const char* ERROR_HTML = R"HTML(<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{margin:0;background:#12110e;color:#c7c0b8;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}
.box{max-width:460px;padding:40px}
.logo{width:84px;height:84px;margin:0 auto 24px;border-radius:20px;background:#ef5b2c;color:#12110e;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:2.4rem}
h1{color:#ffffff;font-size:1.7rem;margin-bottom:10px;letter-spacing:-0.02em}
.fun{color:#ef5b2c;font-weight:600;margin-bottom:14px}
p{color:#8a837c;line-height:1.6;margin-bottom:8px}
a{display:inline-block;margin-top:18px;padding:10px 26px;border-radius:999px;background:#ef5b2c;color:#12110e;font-weight:600;text-decoration:none;cursor:pointer}
a:hover{filter:brightness(1.1)}
.hint{font-size:0.85rem;opacity:0.7;margin-top:14px}
</style></head><body><div class="box">
<div class="logo">C</div>
<h1>404 — полка пуста</h1>
<p class="fun">Кот ушёл в запой и не отвечает на звонки.</p>
<p>Сервер CATio временно недоступен.<br>Проверь, что Apache и MySQL запущены в XAMPP.</p>
<a onclick="catioRetry()">Попробовать снова</a>
<p class="hint">Кот сам проверит сервер каждые 15 секунд</p>
</div></body></html>)HTML";

const int TOP_HEIGHT = 128;       // верхний отступ = LOGO_MARGIN
const int ICON_SIZE_WIN = 8;      // кнопки окна — в 2 раза меньше
const int ICON_SIZE_ARROW = 18;
const int ICON_SIZE_REFRESH = 12;
const int LOGO_SIZE = 36;         // logo.ico и аватар одного размера
const int LOGO_MARGIN = 52;       // отступ лого слева и сверху от края окна
const int MENU_W = 230;           // как .user-menu width в веб
const int MENU_RADIUS = 8;        // var(--radius)
const int MENU_HH = 52;           // шапка: имя + почта
const int MENU_BH = 40;           // строка баланса
const int MENU_IH = 44;           // пункты
const int MENU_H = MENU_HH + MENU_BH + MENU_IH * 2;
const int MENU_GAP = 10;          // top: calc(100% + 10px)

const COLORREF COL_BG       = RGB(18, 17, 14);
const COLORREF COL_TABROW   = RGB(26, 24, 20);
const COLORREF COL_CARD     = RGB(34, 31, 26);   // --bg-card #221f1a
const COLORREF COL_HOVER    = RGB(46, 42, 36);
const COLORREF COL_BORDER   = RGB(46, 42, 36);   // --border #2e2a24 ~
const COLORREF COL_ACCENT   = RGB(239, 91, 44);
const COLORREF COL_TEXT     = RGB(160, 150, 140);
const COLORREF COL_TEXT_BRT = RGB(255, 255, 255);
const COLORREF COL_BODY     = RGB(199, 192, 184);
const COLORREF COL_MUTED    = RGB(138, 131, 124);
const COLORREF COL_URL      = RGB(120, 110, 100);
const COLORREF COL_DISABLED = RGB(80, 75, 70);

#define WM_CATIO_CHECK_DONE (WM_APP + 1)

// Трей (как в Стиме): крестик/минус прячут окно, иконка живёт в трее
#define WM_TRAYICON  (WM_APP + 10)
#define ID_TRAY_OPEN  3001
#define ID_TRAY_EXIT  3002

NOTIFYICONDATAW g_nid = {};
bool g_inTray = false;
bool g_reallyQuit = false; // выход только через меню трея «Выйти»

// Таймеры: тихий автоповтор проверки сервера и показ всплывашки авторизации
#define IDT_RETRY 1001
#define IDT_TOAST 1002

HWND g_hWnd = nullptr;
HICON g_hLogo = nullptr;
webview::webview* g_webview = nullptr;
HWND g_toast = nullptr;
std::string g_currentUrl = STORE_URL;
std::string g_balance = "";
std::string g_username = u8"Гость";
std::string g_email = "";
bool g_guest = true;

// Режим «на весь экран без табов»: либо логин, либо офлайн-404
bool g_coverMode = false;
bool g_authMode  = false;   // ждём авторизацию на полном экране

enum class Section { Store, Library, Community, Profile };
Section g_currentSection = Section::Store;

std::vector<std::string> g_history;
int g_historyIndex = -1;
bool g_maximized = false;
RECT g_restoreRect = {};

// Асинхронная проверка сервера (чтобы UI не зависал)
std::atomic<bool> g_checkBusy{ false };
std::string g_pendingUrl;

// Меню под аватаркой — отдельное popup-окно поверх webview
bool g_menuOpen = false;
int g_menuHover = -1;
HWND g_menuWnd = nullptr;
RECT g_avatarRect = {};
RECT g_menuRect = {};

struct Btn { RECT rc; int id; };
std::vector<Btn> g_buttons;
std::vector<Btn> g_menuItems;

enum {
    ID_BACK = 1, ID_FORWARD, ID_REFRESH,
    ID_STORE, ID_LIBRARY, ID_COMMUNITY, ID_PROFILE,
    ID_AVATAR,
    ID_URL, ID_MIN, ID_MAX, ID_CLOSE
};

// ========== Icon system ==========
struct IconSet {
    HBITMAP normal = nullptr;
    HBITMAP hover  = nullptr;
    HBITMAP disabled = nullptr;
};

IconSet g_icoBack, g_icoForward, g_icoRefresh;
IconSet g_icoMinimiz, g_icoMaximize, g_icoRestore, g_icoClose;

HBITMAP CreateTintedBitmap(HBITMAP src, COLORREF color) {
    if (!src) return nullptr;

    BITMAP bm;
    GetObject(src, sizeof(bm), &bm);
    if (bm.bmBitsPixel != 32) return nullptr;

    int w = bm.bmWidth;
    int h = bm.bmHeight;

    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    void* bits = nullptr;
    HDC hdc = GetDC(nullptr);
    HBITMAP dst = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    ReleaseDC(nullptr, hdc);
    if (!dst || !bits) return nullptr;

    HDC hdcSrc = CreateCompatibleDC(nullptr);
    HDC hdcDst = CreateCompatibleDC(nullptr);
    HGDIOBJ oldSrc = SelectObject(hdcSrc, src);
    HGDIOBJ oldDst = SelectObject(hdcDst, dst);
    BitBlt(hdcDst, 0, 0, w, h, hdcSrc, 0, 0, SRCCOPY);
    SelectObject(hdcSrc, oldSrc);
    SelectObject(hdcDst, oldDst);
    DeleteDC(hdcSrc);
    DeleteDC(hdcDst);

    BYTE* p = (BYTE*)bits;
    BYTE r = GetRValue(color);
    BYTE g = GetGValue(color);
    BYTE b = GetBValue(color);

    for (int i = 0; i < w * h; i++) {
        BYTE a = p[3];
        if (a > 0) {
            p[0] = b;
            p[1] = g;
            p[2] = r;
        }
        p += 4;
    }
    return dst;
}

HBITMAP LoadPngAsBitmap(const wchar_t* path) {
    IWICImagingFactory* factory = nullptr;
    IWICBitmapDecoder* decoder = nullptr;
    IWICBitmapFrameDecode* frame = nullptr;
    IWICFormatConverter* converter = nullptr;
    HBITMAP hbm = nullptr;
    HDC hdc = nullptr;
    void* bits = nullptr;
    UINT w = 0, h = 0;
    BITMAPINFO bmi = {};

    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&factory)))) return nullptr;

    if (FAILED(factory->CreateDecoderFromFilename(path, nullptr, GENERIC_READ,
        WICDecodeMetadataCacheOnLoad, &decoder))) {
        factory->Release();
        return nullptr;
    }

    if (FAILED(decoder->GetFrame(0, &frame))) goto cleanup;
    if (FAILED(factory->CreateFormatConverter(&converter))) goto cleanup;

    if (FAILED(converter->Initialize(frame, GUID_WICPixelFormat32bppPBGRA,
        WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom))) goto cleanup;

    converter->GetSize(&w, &h);

    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = (LONG)w;
    bmi.bmiHeader.biHeight = -(LONG)h;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    hdc = GetDC(nullptr);
    hbm = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    ReleaseDC(nullptr, hdc);
    hdc = nullptr;

    if (hbm && bits) {
        converter->CopyPixels(nullptr, w * 4, w * h * 4, (BYTE*)bits);
    }

cleanup:
    if (converter) converter->Release();
    if (frame) frame->Release();
    if (decoder) decoder->Release();
    if (factory) factory->Release();
    return hbm;
}

void LoadIconSet(IconSet& set, const wchar_t* filename, int size) {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    wchar_t* slash = wcsrchr(path, L'\\');
    if (slash) *(slash + 1) = 0;
    wcscat_s(path, L"icons\\");
    wcscat_s(path, filename);

    HBITMAP src = LoadPngAsBitmap(path);
    if (!src) {
        GetModuleFileNameW(nullptr, path, MAX_PATH);
        slash = wcsrchr(path, L'\\');
        if (slash) *(slash + 1) = 0;
        wcscat_s(path, filename);
        src = LoadPngAsBitmap(path);
    }

    if (!src) return;

    BITMAP bm;
    GetObject(src, sizeof(bm), &bm);
    if (bm.bmWidth != size || bm.bmHeight != size) {
        HDC hdc = GetDC(nullptr);
        HBITMAP resized = CreateCompatibleBitmap(hdc, size, size);
        HDC hdcSrc = CreateCompatibleDC(hdc);
        HDC hdcDst = CreateCompatibleDC(hdc);
        SelectObject(hdcSrc, src);
        SelectObject(hdcDst, resized);
        SetStretchBltMode(hdcDst, HALFTONE);
        StretchBlt(hdcDst, 0, 0, size, size, hdcSrc, 0, 0, bm.bmWidth, bm.bmHeight, SRCCOPY);
        DeleteDC(hdcSrc);
        DeleteDC(hdcDst);
        ReleaseDC(nullptr, hdc);
        DeleteObject(src);
        src = resized;
    }

    set.normal   = CreateTintedBitmap(src, COL_TEXT);
    set.hover    = CreateTintedBitmap(src, COL_TEXT_BRT);
    set.disabled = CreateTintedBitmap(src, COL_DISABLED);
    DeleteObject(src);
}

void LoadAllIcons() {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    LoadIconSet(g_icoBack,     L"back.png",     ICON_SIZE_ARROW);
    LoadIconSet(g_icoForward,  L"forward.png",  ICON_SIZE_ARROW);
    LoadIconSet(g_icoRefresh,  L"refresh.png",  ICON_SIZE_REFRESH);
    LoadIconSet(g_icoMinimiz,  L"minimiz.png",  ICON_SIZE_WIN);
    LoadIconSet(g_icoMaximize, L"maximize.png", ICON_SIZE_WIN);
    LoadIconSet(g_icoRestore,  L"minimize.png", ICON_SIZE_WIN);
    LoadIconSet(g_icoClose,    L"close.png",    ICON_SIZE_WIN);
}

void FreeIconSet(IconSet& set) {
    if (set.normal)   DeleteObject(set.normal);
    if (set.hover)    DeleteObject(set.hover);
    if (set.disabled) DeleteObject(set.disabled);
    set = {};
}

void FreeAllIcons() {
    FreeIconSet(g_icoBack);
    FreeIconSet(g_icoForward);
    FreeIconSet(g_icoRefresh);
    FreeIconSet(g_icoMinimiz);
    FreeIconSet(g_icoMaximize);
    FreeIconSet(g_icoRestore);
    FreeIconSet(g_icoClose);
}

void DrawIconCentered(HDC hdc, const IconSet& set, RECT rc, int size, bool hovered, bool enabled = true) {
    HBITMAP bmp = nullptr;
    if (!enabled) bmp = set.disabled ? set.disabled : set.normal;
    else if (hovered) bmp = set.hover ? set.hover : set.normal;
    else bmp = set.normal;

    if (!bmp) return;

    int x = rc.left + (rc.right - rc.left - size) / 2;
    int y = rc.top  + (rc.bottom - rc.top - size) / 2;

    HDC hdcMem = CreateCompatibleDC(hdc);
    HGDIOBJ old = SelectObject(hdcMem, bmp);

    BLENDFUNCTION bf = { AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
    AlphaBlend(hdc, x, y, size, size, hdcMem, 0, 0, size, size, bf);

    SelectObject(hdcMem, old);
    DeleteDC(hdcMem);
}

// ========== Helpers ==========
std::wstring toWide(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    std::wstring o(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &o[0], n);
    return o;
}

std::wstring toUpperW(const std::string& s) {
    std::wstring w = toWide(s);
    for (auto& ch : w) ch = (wchar_t)towupper(ch);
    return w;
}

void showError(const std::wstring& t, const std::wstring& m) {
    MessageBoxW(nullptr, m.c_str(), t.c_str(), MB_OK | MB_ICONERROR);
}

void copyToClipboard(const std::string& text) {
    if (!OpenClipboard(g_hWnd)) return;
    EmptyClipboard();
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, text.size() + 1);
    if (h) {
        memcpy(GlobalLock(h), text.c_str(), text.size() + 1);
        GlobalUnlock(h);
        SetClipboardData(CF_TEXT, h);
    }
    CloseClipboard();
}

std::string formatBalance(long v) {
    std::string s = std::to_string(v);
    std::string out;
    int cnt = 0;
    for (int i = (int)s.size() - 1; i >= 0; i--) {
        out.insert(out.begin(), s[i]);
        if (++cnt % 3 == 0 && i > 0) out.insert(out.begin(), ' ');
    }
    out += " \xE2\x82\xBD"; // знак рубля ₽
    return out;
}

// ========== Session (запоминаем авторизацию между запусками) ==========
std::wstring sessionPath() {
    wchar_t app[MAX_PATH] = {};
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, app)) && app[0]) {
        std::wstring dir = std::wstring(app) + L"\\CATio";
        CreateDirectoryW(dir.c_str(), nullptr);
        return dir + L"\\session";
    }
    wchar_t p[MAX_PATH];
    GetModuleFileNameW(nullptr, p, MAX_PATH);
    wchar_t* s = wcsrchr(p, L'\\');
    if (s) *(s + 1) = 0;
    return std::wstring(p) + L"session.dat";
}

bool loadSession() {
    HANDLE f = CreateFileW(sessionPath().c_str(), GENERIC_READ, FILE_SHARE_READ,
        nullptr, OPEN_EXISTING, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) return false;
    CloseHandle(f);
    return true;
}

void saveSession() {
    HANDLE f = CreateFileW(sessionPath().c_str(), GENERIC_WRITE, 0, nullptr,
        CREATE_ALWAYS, 0, nullptr);
    if (f != INVALID_HANDLE_VALUE) {
        DWORD w = 0;
        WriteFile(f, "1", 1, &w, nullptr);
        CloseHandle(f);
    }
}

void clearSession() {
    DeleteFileW(sessionPath().c_str());
}

// Грубый разбор JSON-строки из bind-callback (catioSync)
std::string jsonExtractStr(const std::string& req, const char* key) {
    std::string pat = std::string("\"") + key + "\":\"";
    size_t p = req.find(pat);
    if (p == std::string::npos) return "";
    p += pat.size();
    size_t e = req.find('"', p);
    if (e == std::string::npos) return "";
    return req.substr(p, e - p);
}

long jsonExtractInt(const std::string& req, const char* key) {
    std::string pat = std::string("\"") + key + "\":";
    size_t p = req.find(pat);
    if (p == std::string::npos) return 0;
    p += pat.size();
    return atol(req.c_str() + p);
}

bool checkServer() {
    HINTERNET s = WinHttpOpen(L"CATio/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!s) return false;
    HINTERNET c = WinHttpConnect(s, L"localhost", 80, 0);
    if (!c) { WinHttpCloseHandle(s); return false; }
    HINTERNET r = WinHttpOpenRequest(c, L"GET", L"/itch-steam-like/", nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
    if (!r) { WinHttpCloseHandle(c); WinHttpCloseHandle(s); return false; }
    DWORD t = 1500; // суммарно до ~3 сек, но в фоновом потоке — окно не виснет
    WinHttpSetOption(r, WINHTTP_OPTION_CONNECT_TIMEOUT, &t, sizeof(t));
    WinHttpSetOption(r, WINHTTP_OPTION_RECEIVE_TIMEOUT, &t, sizeof(t));
    bool ok = false;
    if (WinHttpSendRequest(r, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
        WinHttpReceiveResponse(r, nullptr)) {
        DWORD st = 0, sz = sizeof(st);
        if (WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX, &st, &sz, WINHTTP_NO_HEADER_INDEX))
            ok = (st >= 200 && st < 400);
    }
    WinHttpCloseHandle(r); WinHttpCloseHandle(c); WinHttpCloseHandle(s);
    return ok;
}

// Проверка сервера в фоновом потоке — результат придёт через WM_CATIO_CHECK_DONE.
// UI поток не блокируется, вкладки переключаются мгновенно даже при лежачем сервере.
void checkServerAsync(const std::string& urlOnOk) {
    if (g_checkBusy.exchange(true)) return; // уже идёт проверка
    g_pendingUrl = urlOnOk;
    std::thread([]() {
        bool ok = checkServer();
        g_checkBusy.store(false);
        if (g_hWnd) PostMessageW(g_hWnd, WM_CATIO_CHECK_DONE, ok ? 1 : 0, 0);
    }).detach();
}

void layoutWebview() {
    if (!g_hWnd || !g_webview) return;
    RECT rc; GetClientRect(g_hWnd, &rc);
    int top = g_coverMode ? 0 : TOP_HEIGHT;
    HWND child = FindWindowExW(g_hWnd, nullptr, nullptr, nullptr);
    while (child) {
        SetWindowPos(child, nullptr, 0, top,
            rc.right, (std::max)(50L, rc.bottom - top), SWP_NOZORDER);
        child = FindWindowExW(g_hWnd, child, nullptr, nullptr);
    }
}

// Вперёд-объявления меню (реализация ниже, рядом с WndProc)
void closeAvatarMenu();
void openAvatarMenu();
void paintAvatarMenu(HDC hdc, int w, int h);

// Показывает кастомную 404 на весь экран. Навигации в сеть нет — нативной
// ошибки WebView2 не будет ни при автоповторе, ни по кнопке.
void showOfflinePage() {
    if (!g_webview) return;
    g_coverMode = true;
    layoutWebview();
    g_webview->set_html(ERROR_HTML);
    g_currentUrl = u8"Сервер недоступен";
    SetTimer(g_hWnd, IDT_RETRY, 15000, nullptr); // кот тихо проверяет сервер раз в 15 сек
    InvalidateRect(g_hWnd, nullptr, FALSE);
}

void navigateTo(const std::string& url, bool addHist = true) {
    if (!g_webview) return;
    if (addHist) {
        if (g_historyIndex + 1 < (int)g_history.size())
            g_history.resize(g_historyIndex + 1);
        g_history.push_back(url);
        g_historyIndex = (int)g_history.size() - 1;
    }
    KillTimer(g_hWnd, IDT_RETRY);               // сервер ответил — автоповтор не нужен
    if (!g_authMode) {                          // логин остаётся на весь экран до конца
        g_coverMode = false;
        layoutWebview();
    }
    g_currentUrl = url;
    g_webview->navigate(url);
    InvalidateRect(g_hWnd, nullptr, FALSE);
}

void goBack() {
    if (g_historyIndex > 0) {
        g_historyIndex--;
        navigateTo(g_history[g_historyIndex], false);
    }
}
void goForward() {
    if (g_historyIndex + 1 < (int)g_history.size()) {
        g_historyIndex++;
        navigateTo(g_history[g_historyIndex], false);
    }
}

const char* sectionUrl(Section s) {
    if (s == Section::Profile && g_guest) return AUTH_URL;
    switch (s) {
        case Section::Store:     return STORE_URL;
        case Section::Library:   return LIBRARY_URL;
        case Section::Community: return COMMUNITY_URL;
        case Section::Profile:   return PROFILE_URL;
    }
    return STORE_URL;
}

void doRefresh() {
    // Визуально переключаемся сразу, проверка — в фоне
    checkServerAsync(sectionUrl(g_currentSection));
    InvalidateRect(g_hWnd, nullptr, FALSE);
}

void switchSection(Section s) {
    g_currentSection = s;
    InvalidateRect(g_hWnd, nullptr, TRUE);
    checkServerAsync(sectionUrl(s));
}

void toggleMaximize() {
    if (!g_maximized) {
        GetWindowRect(g_hWnd, &g_restoreRect);
        HMONITOR hMon = MonitorFromWindow(g_hWnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi = { sizeof(mi) };
        GetMonitorInfoW(hMon, &mi);
        SetWindowPos(g_hWnd, nullptr, mi.rcWork.left, mi.rcWork.top,
            mi.rcWork.right - mi.rcWork.left, mi.rcWork.bottom - mi.rcWork.top, SWP_NOZORDER);
        g_maximized = true;
    } else {
        SetWindowPos(g_hWnd, nullptr, g_restoreRect.left, g_restoreRect.top,
            g_restoreRect.right - g_restoreRect.left, g_restoreRect.bottom - g_restoreRect.top, SWP_NOZORDER);
        g_maximized = false;
    }
    layoutWebview();
    InvalidateRect(g_hWnd, nullptr, TRUE);
}

void drawText(HDC hdc, RECT rc, const wchar_t* text, COLORREF color, int size, bool bold, UINT align = DT_LEFT) {
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, color);
    HFONT f = CreateFontW(size, 0, 0, 0, bold ? FW_BOLD : FW_SEMIBOLD, 0, 0, 0,
        DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    HFONT old = (HFONT)SelectObject(hdc, f);
    DrawTextW(hdc, text, -1, &rc, align | DT_VCENTER | DT_SINGLELINE);
    SelectObject(hdc, old);
    DeleteObject(f);
}

void loadLogo() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    wchar_t* slash = wcsrchr(path, L'\\');
    if (slash) *(slash + 1) = 0;
    wcscat_s(path, L"logo.ico");
    g_hLogo = (HICON)LoadImageW(nullptr, path, IMAGE_ICON, 40, 40, LR_LOADFROMFILE | LR_DEFAULTSIZE);
    if (!g_hLogo) {
        g_hLogo = (HICON)LoadImageW(nullptr, L"logo.ico", IMAGE_ICON, 40, 40, LR_LOADFROMFILE);
    }
}

// ========== Трей (как в Стиме) ==========
void trayAdd() {
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = g_hWnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = g_hLogo ? g_hLogo : LoadIcon(nullptr, IDI_APPLICATION);
    wcscpy_s(g_nid.szTip, L"CATio");
    Shell_NotifyIconW(NIM_ADD, &g_nid);
}

void trayRemove() {
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
    g_nid = {};
}

void minimizeToTray() {
    ShowWindow(g_hWnd, SW_HIDE);
    g_inTray = true;
}

void restoreFromTray() {
    g_inTray = false;
    ShowWindow(g_hWnd, SW_SHOW);
    SetForegroundWindow(g_hWnd);
    layoutWebview();
    InvalidateRect(g_hWnd, nullptr, TRUE);
}

void showTrayMenu() {
    POINT pt;
    GetCursorPos(&pt);
    HMENU menu = CreatePopupMenu();
    AppendMenuW(menu, MF_STRING, ID_TRAY_OPEN, L"Открыть CATio");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, ID_TRAY_EXIT, L"Выйти");
    SetMenuDefaultItem(menu, ID_TRAY_OPEN, FALSE);
    SetForegroundWindow(g_hWnd); // чтобы меню закрылось при клике мимо
    TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, g_hWnd, nullptr);
    DestroyMenu(menu);
}

// ========== Всплывашка «Успешная авторизация» ==========
// Layered-окно: рисуем битмап в памяти (иконка + текст) и показываем через
// UpdateLayeredWindow. Держится ~1.8 сек, потом WM_TIMER пускает в интерфейс.
void showAuthToast() {
    const int W = 340, H = 96;
    RECT rc; GetWindowRect(g_hWnd, &rc);
    int x = rc.left + ((rc.right - rc.left) - W) / 2;
    int y = rc.top  + ((rc.bottom - rc.top) - H) / 2;

    g_toast = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
        L"CATioToast", nullptr, WS_POPUP,
        x, y, W, H, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!g_toast) { // запасной вариант — без всплывашки сразу в интерфейс
        g_authMode = false;
        g_currentSection = Section::Store;
        navigateTo(STORE_URL);
        return;
    }

    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = W;
    bmi.bmiHeader.biHeight = -H;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    void* bits = nullptr;
    HDC screen = GetDC(nullptr);
    HBITMAP bmp = CreateDIBSection(screen, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    HDC mem = CreateCompatibleDC(screen);
    HGDIOBJ old = SelectObject(mem, bmp);

    HBRUSH bg = CreateSolidBrush(RGB(26, 24, 20));
    RECT r{0, 0, W, H};
    FillRect(mem, &r, bg);
    DeleteObject(bg);

    if (g_hLogo) {
        DrawIconEx(mem, 18, (H - 40) / 2, g_hLogo, 40, 40, 0, nullptr, DI_NORMAL);
    }

    drawText(mem, RECT{70, 12, W - 16, 48}, L"Авторизация успешна", COL_TEXT_BRT, 16, true, DT_LEFT);
    std::wstring sub = L"Добро пожаловать, " + toWide(g_username);
    drawText(mem, RECT{70, 46, W - 16, 80}, sub.c_str(), COL_BODY, 13, false, DT_LEFT);

    // GDI-заливка не пишет альфу (остаётся 0), UpdateLayeredWindow требует
    // premultiplied alpha — чиним: прозрачные-судя-по-GDI пиксели делаем opaque.
    BYTE* p = (BYTE*)bits;
    for (int i = 0; i < W * H; i++, p += 4) {
        BYTE a = p[3] ? p[3] : 255;
        p[0] = (BYTE)(p[0] * a / 255);
        p[1] = (BYTE)(p[1] * a / 255);
        p[2] = (BYTE)(p[2] * a / 255);
        p[3] = a;
    }

    POINT dst{x, y}, src{0, 0};
    SIZE sz{W, H};
    BLENDFUNCTION bf{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    UpdateLayeredWindow(g_toast, screen, &dst, &sz, mem, &src, 0, &bf, ULW_ALPHA);

    SelectObject(mem, old);
    DeleteDC(mem);
    DeleteObject(bmp);
    ReleaseDC(nullptr, screen);

    ShowWindow(g_toast, SW_SHOWNA);
    SetTimer(g_hWnd, IDT_TOAST, 1800, nullptr);
}

// ========== Меню аватара (popup поверх webview, без сдвига) ==========
void closeAvatarMenu() {
    if (g_menuWnd) {
        DestroyWindow(g_menuWnd);
        g_menuWnd = nullptr;
    }
    g_menuOpen = false;
    g_menuHover = -1;
    g_menuItems.clear();
    if (g_hWnd) InvalidateRect(g_hWnd, nullptr, FALSE);
}

void paintAvatarMenu(HDC hdc, int w, int h) {
    // Фон + скругление как .user-menu { border-radius: 8px }
    HBRUSH mbg = CreateSolidBrush(COL_CARD);
    HPEN borderPen = CreatePen(PS_SOLID, 1, COL_BORDER);
    HGDIOBJ oldBr = SelectObject(hdc, mbg);
    HGDIOBJ oldPn = SelectObject(hdc, borderPen);
    RoundRect(hdc, 0, 0, w, h, MENU_RADIUS * 2, MENU_RADIUS * 2);
    SelectObject(hdc, oldBr);
    SelectObject(hdc, oldPn);
    DeleteObject(mbg);
    DeleteObject(borderPen);

    g_menuItems.clear();

    // .user-menu-head — имя + почта
    RECT hR = { 16, 0, w - 16, MENU_HH };
    g_menuItems.push_back({ hR, 0 });
    RECT rName = { hR.left, 12, hR.right, 32 };
    drawText(hdc, rName, toWide(g_username).c_str(), COL_TEXT_BRT, 15, true, DT_LEFT);
    RECT rMail = { hR.left, 30, hR.right, 48 };
    drawText(hdc, rMail, toWide(g_email).c_str(), COL_MUTED, 12, false, DT_LEFT);

    // разделитель под шапкой
    HPEN sep = CreatePen(PS_SOLID, 1, COL_BORDER);
    HPEN os = (HPEN)SelectObject(hdc, sep);
    MoveToEx(hdc, 0, MENU_HH, nullptr);
    LineTo(hdc, w, MENU_HH);

    // .user-menu-balance
    RECT bR = { 16, MENU_HH, w - 16, MENU_HH + MENU_BH };
    g_menuItems.push_back({ bR, 0 });
    drawText(hdc, bR, L"Баланс", COL_MUTED, 13, false, DT_LEFT);
    std::wstring bal = toWide(g_balance.empty() ? "0 \xE2\x82\xBD" : g_balance);
    drawText(hdc, bR, bal.c_str(), COL_ACCENT, 15, true, DT_RIGHT);

    MoveToEx(hdc, 0, MENU_HH + MENU_BH, nullptr);
    LineTo(hdc, w, MENU_HH + MENU_BH);
    SelectObject(hdc, os);
    DeleteObject(sep);

    // .user-menu-item / .user-menu-item.danger
    struct Item { const wchar_t* txt; int id; bool danger; };
    Item items[] = { { L"⚙  Настройки", 1, false }, { L"↪  Выйти", 2, true } };
    int iy = MENU_HH + MENU_BH;
    for (auto& it : items) {
        RECT r = { 0, iy, w, iy + MENU_IH };
        g_menuItems.push_back({ r, it.id });
        if (g_menuHover == it.id) {
            HBRUSH hb = CreateSolidBrush(COL_HOVER);
            FillRect(hdc, &r, hb);
            DeleteObject(hb);
        }
        RECT tr = { 16, r.top, w - 16, r.bottom };
        COLORREF col = COL_BODY;
        if (g_menuHover == it.id)
            col = it.danger ? COL_ACCENT : COL_TEXT_BRT;
        drawText(hdc, tr, it.txt, col, 14, false, DT_LEFT);
        iy += MENU_IH;
    }
}

LRESULT CALLBACK MenuWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hWnd, &ps);
        RECT rc; GetClientRect(hWnd, &rc);
        paintAvatarMenu(hdc, rc.right, rc.bottom);
        EndPaint(hWnd, &ps);
        return 0;
    }
    case WM_MOUSEMOVE: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);
        int old = g_menuHover;
        g_menuHover = -1;
        for (const auto& mi : g_menuItems) {
            if (mi.id != 0 && mx >= mi.rc.left && mx <= mi.rc.right &&
                my >= mi.rc.top && my <= mi.rc.bottom) {
                g_menuHover = mi.id;
                break;
            }
        }
        if (g_menuHover != old) InvalidateRect(hWnd, nullptr, FALSE);
        return 0;
    }
    case WM_LBUTTONDOWN: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);
        for (const auto& mi : g_menuItems) {
            if (mx >= mi.rc.left && mx <= mi.rc.right &&
                my >= mi.rc.top && my <= mi.rc.bottom) {
                if (mi.id == 1) {
                    closeAvatarMenu();
                    MessageBoxW(g_hWnd, L"Настройки скоро появятся. Кот ещё их пакует.", L"CATio", MB_OK | MB_ICONINFORMATION);
                } else if (mi.id == 2) {
                    closeAvatarMenu();
                    clearSession();
                    if (g_webview) g_webview->eval("try{logout()}catch(e){}");
                }
                return 0;
            }
        }
        return 0;
    }
    case WM_ACTIVATE:
        // Клик мимо — Windows шлёт WA_INACTIVE, закрываем меню
        if (LOWORD(wParam) == WA_INACTIVE) {
            // Отложенно, чтобы клик по аве мог переключить (toggle)
            PostMessageW(g_hWnd, WM_APP + 50, 0, 0);
        }
        return 0;
    case WM_DESTROY:
        g_menuWnd = nullptr;
        g_menuOpen = false;
        return 0;
    }
    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

static bool g_ignoreMenuClose = false;

void openAvatarMenu() {
    if (g_guest) return;
    // Toggle: если уже открыто — закрыть и не открывать снова в этом клике
    if (g_menuWnd || g_menuOpen) {
        g_ignoreMenuClose = true;
        closeAvatarMenu();
        return;
    }

    // Позиция: под аватаром, выровнено по правому краю авы (screen coords)
    POINT pt = { g_avatarRect.right - MENU_W, g_avatarRect.bottom + MENU_GAP };
    ClientToScreen(g_hWnd, &pt);
    if (pt.x < 8) pt.x = 8;

    g_menuWnd = CreateWindowExW(
        WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
        L"CATioMenu", nullptr,
        WS_POPUP | WS_VISIBLE,
        pt.x, pt.y, MENU_W, MENU_H,
        g_hWnd, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!g_menuWnd) return;

    // Скругление окна как border-radius: 8px в веб-версии
    HRGN rgn = CreateRoundRectRgn(0, 0, MENU_W + 1, MENU_H + 1, MENU_RADIUS * 2, MENU_RADIUS * 2);
    SetWindowRgn(g_menuWnd, rgn, TRUE); // система владеет rgn после SetWindowRgn

    g_menuOpen = true;
    g_menuHover = -1;
    SetWindowPos(g_menuWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetForegroundWindow(g_menuWnd);
    InvalidateRect(g_menuWnd, nullptr, FALSE);
}

// ========== Window Proc ==========
LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    static int hoverId = 0;

    switch (msg) {
    case WM_NCCALCSIZE:
        if (wParam) return 0;
        break;

    case WM_SIZE:
        layoutWebview();
        InvalidateRect(hWnd, nullptr, FALSE);
        break;

    case WM_CATIO_CHECK_DONE:
        // Проверка сервера завершилась в фоне: переходим или показываем «кот в запое»
        if (wParam) {
            if (g_authMode) {
                // логин-страница остаётся на весь экран (cover не снимаем)
                KillTimer(hWnd, IDT_RETRY);
                g_webview->navigate(g_pendingUrl);
                g_currentUrl = g_pendingUrl;
            } else {
                navigateTo(g_pendingUrl);
            }
        } else {
            showOfflinePage();
        }
        break;

    case WM_TIMER:
        if (wParam == IDT_RETRY) {
            // Тихая проверка: если сервер поднялся — navigateTo сам уберёт 404.
            // Навигации на мёртвый URL не происходит никогда -> нативной ошибки нет.
            checkServerAsync(g_pendingUrl);
        } else if (wParam == IDT_TOAST) {
            KillTimer(hWnd, IDT_TOAST);
            if (g_toast) { DestroyWindow(g_toast); g_toast = nullptr; }
            g_authMode = false;
            g_currentSection = Section::Store; // после входа всегда каталог, а не старый профиль
            navigateTo(STORE_URL);
        }
        break;

    case WM_TRAYICON:
        // ЛКМ/двойной клик — открыть окно, ПКМ — меню
        if (lParam == WM_LBUTTONUP || lParam == WM_LBUTTONDBLCLK) {
            restoreFromTray();
        } else if (lParam == WM_RBUTTONUP) {
            showTrayMenu();
        }
        break;

    case WM_COMMAND:
        if (LOWORD(wParam) == ID_TRAY_OPEN) {
            restoreFromTray();
        } else if (LOWORD(wParam) == ID_TRAY_EXIT) {
            g_reallyQuit = true;
            DestroyWindow(hWnd); // настоящий выход из приложения
        }
        break;

    case WM_CLOSE:
        // Крестик не закрывает приложение, а прячет в трей — как в Стиме.
        // Настоящий выход только через меню трея -> «Выйти».
        if (!g_reallyQuit) {
            minimizeToTray();
            return 0;
        }
        break;

    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE && g_menuOpen) {
            closeAvatarMenu();
        }
        break;

    case WM_APP + 50: // отложенное закрытие меню после WA_INACTIVE
        if (g_ignoreMenuClose) { g_ignoreMenuClose = false; break; }
        closeAvatarMenu();
        break;

    case WM_PAINT: {
        if (g_coverMode) { // вебвью на весь экран — панель рисовать не нужно
            PAINTSTRUCT ps;
            BeginPaint(hWnd, &ps);
            EndPaint(hWnd, &ps);
            break;
        }
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hWnd, &ps);
        RECT rc; GetClientRect(hWnd, &rc);

        HBRUSH bg = CreateSolidBrush(COL_BG);
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);

        HPEN pen = CreatePen(PS_SOLID, 1, RGB(40, 36, 30));
        HPEN op = (HPEN)SelectObject(hdc, pen);
        MoveToEx(hdc, 0, TOP_HEIGHT - 1, nullptr);
        LineTo(hdc, rc.right, TOP_HEIGHT - 1);
        SelectObject(hdc, op);
        DeleteObject(pen);

        g_buttons.clear();

        // Весь верхний блок (табы + URL) одним цветом
        {
            HBRUSH rowBg = CreateSolidBrush(COL_TABROW);
            RECT rowR = { 0, 0, rc.right, TOP_HEIGHT };
            FillRect(hdc, &rowR, rowBg);
            DeleteObject(rowBg);
        }

        // ===== ROW 1: лого + вкладки + аватар =====
        // сверху такой же отступ, как слева у лого
        int logoTop = LOGO_MARGIN;
        int y1 = logoTop;
        int h1 = LOGO_SIZE;

        // Logo + CATio (отступ слева = LOGO_MARGIN)
        int logoX = LOGO_MARGIN;
        if (g_hLogo) {
            DrawIconEx(hdc, logoX, logoTop, g_hLogo, LOGO_SIZE, LOGO_SIZE, 0, nullptr, DI_NORMAL);
            logoX += LOGO_SIZE + 10;
        } else {
            HBRUSH br = CreateSolidBrush(COL_ACCENT);
            RECT box = { logoX, logoTop, logoX + LOGO_SIZE, logoTop + LOGO_SIZE };
            FillRect(hdc, &box, br);
            DeleteObject(br);
            drawText(hdc, box, L"C", COL_BG, 18, true, DT_CENTER);
            logoX += LOGO_SIZE + 10;
        }
        {
            RECT r = { logoX, y1, logoX + 100, y1 + h1 };
            drawText(hdc, r, L"CATio", COL_ACCENT, 26, true, DT_LEFT);
        }

        // Tabs
        int x = 170;
        auto addTab = [&](const wchar_t* label, int id, bool active, int w) {
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, id });
            COLORREF col = active ? COL_ACCENT : (hoverId == id ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, label, col, 17, true, DT_CENTER);
            if (active) {
                HPEN p2 = CreatePen(PS_SOLID, 3, COL_ACCENT);
                HPEN o2 = (HPEN)SelectObject(hdc, p2);
                MoveToEx(hdc, r.left + 6, r.bottom - 2, nullptr);
                LineTo(hdc, r.right - 6, r.bottom - 2);
                SelectObject(hdc, o2);
                DeleteObject(p2);
            }
            x += w + 2;
        };
        addTab(L"КАТАЛОГ",    ID_STORE,     g_currentSection == Section::Store,     110);
        addTab(L"БИБЛИОТЕКА", ID_LIBRARY,   g_currentSection == Section::Library,   125);
        addTab(L"МАСТЕРСКАЯ", ID_COMMUNITY, g_currentSection == Section::Community, 125);

        {
            // У гостя — ВОЙТИ, у авторизованного — ник ВЕРХНИМ РЕГИСТРОМ
            std::wstring tabLabel = g_guest ? L"ВОЙТИ" : toUpperW(g_username);
            // ширина под текст ника
            int w = 100;
            {
                HDC tmp = GetDC(hWnd);
                HFONT f = CreateFontW(17, 0, 0, 0, FW_BOLD, 0, 0, 0,
                    DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
                HFONT old = (HFONT)SelectObject(tmp, f);
                SIZE sz = {};
                GetTextExtentPoint32W(tmp, tabLabel.c_str(), (int)tabLabel.size(), &sz);
                SelectObject(tmp, old);
                DeleteObject(f);
                ReleaseDC(hWnd, tmp);
                w = (std::max)(80, (int)sz.cx + 24);
            }
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, ID_PROFILE });
            bool active = g_currentSection == Section::Profile && !g_guest;
            COLORREF col = active ? COL_ACCENT : (hoverId == ID_PROFILE ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, tabLabel.c_str(), col, 17, true, DT_CENTER);
            if (active) {
                HPEN p2 = CreatePen(PS_SOLID, 3, COL_ACCENT);
                HPEN o2 = (HPEN)SelectObject(hdc, p2);
                MoveToEx(hdc, r.left + 6, r.bottom - 2, nullptr);
                LineTo(hdc, r.right - 6, r.bottom - 2);
                SelectObject(hdc, o2);
                DeleteObject(p2);
            }
        }

        // ===== Кнопки окна — отдельный блок у верхнего правого угла =====
        const int winBtnSize = 22;
        const int winBtnGap  = 2;
        int winY = 8;
        int rx = rc.right - 6;
        auto addWinBtn = [&](const IconSet& ico, int id) {
            RECT r = { rx - winBtnSize, winY, rx, winY + winBtnSize };
            g_buttons.push_back({ r, id });
            DrawIconCentered(hdc, ico, r, ICON_SIZE_WIN, hoverId == id);
            rx -= (winBtnSize + winBtnGap);
        };
        addWinBtn(g_icoClose, ID_CLOSE);
        addWinBtn(g_maximized ? g_icoRestore : g_icoMaximize, ID_MAX);
        addWinBtn(g_icoMinimiz, ID_MIN);

        // Avatar левее кнопок окна, верх = как у лого (LOGO_MARGIN от края)
        int av = LOGO_SIZE;
        int avX = rx - 12 - av;   // сдвиг влево от кнопок
        int avY = logoTop;
        HBRUSH abr = CreateSolidBrush(COL_ACCENT);
        HPEN apn = CreatePen(PS_SOLID, 1, COL_ACCENT);
        HGDIOBJ ob = SelectObject(hdc, abr);
        HGDIOBJ op2 = SelectObject(hdc, apn);
        Ellipse(hdc, avX, avY, avX + av, avY + av);
        SelectObject(hdc, ob);
        SelectObject(hdc, op2);
        DeleteObject(abr);
        DeleteObject(apn);
        RECT rAv = { avX, avY, avX + av, avY + av };
        g_avatarRect = rAv;
        g_buttons.push_back({ rAv, ID_AVATAR });
        if (hoverId == ID_AVATAR && !g_guest) {
            HPEN ring = CreatePen(PS_SOLID, 2, COL_TEXT_BRT);
            HPEN oring = (HPEN)SelectObject(hdc, ring);
            Ellipse(hdc, avX - 2, avY - 2, avX + av + 2, avY + av + 2);
            SelectObject(hdc, oring);
            DeleteObject(ring);
        }
        std::wstring avLetter = g_guest ? L"?" : toUpperW(g_username.substr(0, 1));
        drawText(hdc, rAv, avLetter.c_str(), COL_BG, 16, true, DT_CENTER);

        // Меню рисуется в отдельном popup-окне (openAvatarMenu), не здесь.

        // ===== ROW 2: стрелки + refresh + url =====
        int y2 = 100;
        int h2 = 22;

        int ax = 53;
        bool canBack    = g_historyIndex > 0;
        bool canForward = g_historyIndex + 1 < (int)g_history.size();

        {
            RECT r = { ax, y2, ax + 22, y2 + h2 };
            g_buttons.push_back({ r, ID_BACK });
            DrawIconCentered(hdc, g_icoBack, r, ICON_SIZE_ARROW, hoverId == ID_BACK && canBack, canBack);
            ax += 22;
        }
        {
            RECT r = { ax, y2, ax + 22, y2 + h2 };
            g_buttons.push_back({ r, ID_FORWARD });
            DrawIconCentered(hdc, g_icoForward, r, ICON_SIZE_ARROW, hoverId == ID_FORWARD && canForward, canForward);
            ax += 24;
        }
        {
            RECT r = { ax, y2, ax + 20, y2 + h2 };
            g_buttons.push_back({ r, ID_REFRESH });
            DrawIconCentered(hdc, g_icoRefresh, r, ICON_SIZE_REFRESH, hoverId == ID_REFRESH, true);
            ax += 24;
        }

        x = ax + 6;

        std::wstring urlW = toWide(g_currentUrl);
        size_t p = urlW.find(L"?client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);
        p = urlW.find(L"&client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);

        HFONT fUrl = CreateFontW(12, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0,
            DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
        HFONT oldF = (HFONT)SelectObject(hdc, fUrl);
        SIZE sz = {};
        GetTextExtentPoint32W(hdc, urlW.c_str(), (int)urlW.size(), &sz);
        SelectObject(hdc, oldF);
        DeleteObject(fUrl);

        int urlWpx = sz.cx + 4;
        RECT rUrl = { x, y2, x + urlWpx, y2 + h2 };
        g_buttons.push_back({ rUrl, ID_URL });
        drawText(hdc, rUrl, urlW.c_str(), hoverId == ID_URL ? COL_ACCENT : COL_URL, 12, false, DT_LEFT);

        EndPaint(hWnd, &ps);
        break;
    }

    case WM_LBUTTONDOWN: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);

        for (const auto& b : g_buttons) {
            if (mx >= b.rc.left && mx <= b.rc.right && my >= b.rc.top && my <= b.rc.bottom) {
                switch (b.id) {
                    case ID_BACK:    if (g_historyIndex > 0) goBack(); break;
                    case ID_FORWARD: if (g_historyIndex + 1 < (int)g_history.size()) goForward(); break;
                    case ID_REFRESH: doRefresh(); break;
                    case ID_STORE:     switchSection(Section::Store); break;
                    case ID_LIBRARY:   switchSection(Section::Library); break;
                    case ID_COMMUNITY: switchSection(Section::Community); break;
                    case ID_PROFILE:   switchSection(Section::Profile); break;
                    case ID_AVATAR:
                        if (!g_guest) openAvatarMenu(); // toggle: повторный клик закроет
                        break;
                    case ID_URL: {
                        std::string clean = g_currentUrl;
                        size_t pos = clean.find("?client=1");
                        if (pos != std::string::npos) clean = clean.substr(0, pos);
                        pos = clean.find("&client=1");
                        if (pos != std::string::npos) clean = clean.substr(0, pos);
                        copyToClipboard(clean);
                        MessageBoxW(hWnd, L"Ссылка скопирована", L"CATio", MB_OK | MB_ICONINFORMATION);
                        break;
                    }
                    case ID_MIN: minimizeToTray(); break;
                    case ID_MAX: toggleMaximize(); break;
                    case ID_CLOSE: PostMessageW(hWnd, WM_CLOSE, 0, 0); break;
                }
                return 0;
            }
        }
        if (my < TOP_HEIGHT) {
            ReleaseCapture();
            SendMessageW(hWnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        }
        break;
    }

    case WM_LBUTTONDBLCLK:
        if (GET_Y_LPARAM(lParam) < TOP_HEIGHT) toggleMaximize();
        break;

    case WM_MOUSEMOVE: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);
        int old = hoverId;
        hoverId = 0;
        for (const auto& b : g_buttons) {
            if (mx >= b.rc.left && mx <= b.rc.right && my >= b.rc.top && my <= b.rc.bottom) {
                hoverId = b.id;
                break;
            }
        }
        int oldMenuHover = g_menuHover;
        g_menuHover = -1;
        if (g_menuOpen) {
            for (const auto& mi : g_menuItems) {
                if (mi.id != 0 && mx >= mi.rc.left && mx <= mi.rc.right && my >= mi.rc.top && my <= mi.rc.bottom) {
                    g_menuHover = mi.id;
                    break;
                }
            }
        }
        if (hoverId != old || g_menuHover != oldMenuHover) {
            RECT top = { 0, 0, 8000, TOP_HEIGHT + 220 };
            InvalidateRect(hWnd, &top, FALSE);
        }
        break;
    }

    case WM_ERASEBKGND: return 1;

    case WM_DESTROY:
        closeAvatarMenu();
        trayRemove(); // иначе в трее останется «мёртвая» иконка
        KillTimer(hWnd, IDT_RETRY);
        KillTimer(hWnd, IDT_TOAST);
        if (g_toast) { DestroyWindow(g_toast); g_toast = nullptr; }
        if (g_hLogo) { DestroyIcon(g_hLogo); g_hLogo = nullptr; }
        FreeAllIcons();
        PostQuitMessage(0);
        break;

    default:
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }
    return 0;
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR, int nShow) {
    INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_STANDARD_CLASSES };
    InitCommonControlsEx(&icc);

    // Класс для всплывашки авторизации (layered-окно, рисуем через UpdateLayeredWindow)
    WNDCLASSEXW twc = {};
    twc.cbSize = sizeof(twc);
    twc.lpfnWndProc = DefWindowProcW;
    twc.hInstance = hInst;
    twc.lpszClassName = L"CATioToast";
    RegisterClassExW(&twc);

    // Класс меню аватара (popup поверх webview)
    WNDCLASSEXW mwc = {};
    mwc.cbSize = sizeof(mwc);
    mwc.lpfnWndProc = MenuWndProc;
    mwc.hInstance = hInst;
    mwc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    mwc.hbrBackground = CreateSolidBrush(COL_CARD);
    mwc.lpszClassName = L"CATioMenu";
    RegisterClassExW(&mwc);

    loadLogo();
    LoadAllIcons();

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(COL_BG);
    wc.lpszClassName = L"CATioLauncher";
    wc.hIcon = g_hLogo ? g_hLogo : LoadIcon(nullptr, IDI_APPLICATION);
    RegisterClassExW(&wc);

    g_hWnd = CreateWindowExW(
        WS_EX_APPWINDOW, L"CATioLauncher", APP_TITLE,
        WS_POPUP | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CLIPCHILDREN,
        100, 100, 1280, 840, nullptr, nullptr, hInst, nullptr);

    if (!g_hWnd) {
        showError(L"CATio", L"Не удалось создать окно");
        return 1;
    }

    BOOL dark = TRUE;
    DwmSetWindowAttribute(g_hWnd, 20, &dark, sizeof(dark));
    // Скруглённые углы на Windows 11: у окон без стандартной рамки (WS_POPUP)
    // DWM их не рисует — просим явно через DWMWA_WINDOW_CORNER_PREFERENCE
    int cornerPref = 2; // DWMWCP_ROUND
    DwmSetWindowAttribute(g_hWnd, 33, &cornerPref, sizeof(cornerPref));
    MARGINS m = { 0, 0, 0, 0 };
    DwmExtendFrameIntoClientArea(g_hWnd, &m);

    ShowWindow(g_hWnd, nShow);
    UpdateWindow(g_hWnd);
    trayAdd(); // иконка в трее с самого запуска, как у Стима

    try {
        g_webview = new webview::webview(true, g_hWnd);
        layoutWebview();

        // Синхронизация с веб-страницей: имя, баланс, гость/не гость.
        // Страница (index.php) шлёт AUTH_STATE через catioSync.
        g_webview->bind("catioSync", [](const std::string& req) -> std::string {
            bool auth = req.find("\"authorized\":true") != std::string::npos
                     || req.find("\"authorized\": true") != std::string::npos;
            bool becameAuthed = auth && g_guest;
            bool becameGuest   = !auth && !g_guest;
            g_guest = !auth;
            std::string name = jsonExtractStr(req, "username");
            if (name.empty()) name = u8"Гость";
            g_username = name;
            g_email = auth ? jsonExtractStr(req, "email") : "";
            g_balance = auth ? formatBalance(jsonExtractInt(req, "balance")) : "";

            if (becameAuthed) {
                saveSession();
                if (g_authMode) showAuthToast(); // лого + «успешно», потом WM_TIMER -> интерфейс
            }
            if (becameGuest) {
                // сессия протухла или вышли — обратно на логин на весь экран
                clearSession();
                g_authMode = true;
                g_coverMode = true;
                layoutWebview();
                checkServerAsync(AUTH_URL);
            }

            if (g_hWnd) InvalidateRect(g_hWnd, nullptr, FALSE);
            return "";
        });

        // Кнопка «Попробовать снова» на 404 — проверяем сервер из C++,
        // вебвью на мёртвый URL не уходит, нативной ошибки нет.
        g_webview->bind("catioRetry", [](const std::string&) -> std::string {
            KillTimer(g_hWnd, IDT_RETRY);
            checkServerAsync(g_pendingUrl);
            return "";
        });

        // Поток запуска: сервер лежит -> 404 на весь экран (таймер сам дождётся
        // сервер); не авторизован -> логин на весь экран; иначе -> каталог.
        bool authed = loadSession();
        g_authMode  = !authed;
        g_coverMode = true;
        layoutWebview();
        checkServerAsync(authed ? STORE_URL : AUTH_URL);
    } catch (const std::exception& e) {
        showError(L"CATio", L"Ошибка WebView2:\n" + toWide(e.what()));
        return 1;
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    delete g_webview;
    return 0;
}

#ifdef __GNUC__
int main() {
    return wWinMain(GetModuleHandleW(nullptr), nullptr, GetCommandLineW(), SW_SHOW);
}
#endif
