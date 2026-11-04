// CATio - Frameless launcher with custom icons
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <winhttp.h>
#include <dwmapi.h>
#include <wincodec.h>
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

// Страница «сервер недоступен».
// ВАЖНО: в data: URL нельзя использовать символ # — он обрезает URL,
// поэтому все цвета пишем через rgb(). Страница сама перезагрузится через 15 сек.
const char* ERROR_HTML = R"(data:text/html,<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15;url=http://localhost/itch-steam-like/?client=1">
<style>
body{margin:0;background:rgb(18,17,14);color:rgb(199,192,184);font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}
.box{max-width:460px;padding:40px}
.logo{width:84px;height:84px;margin:0 auto 24px;border-radius:20px;background:rgb(239,91,44);color:rgb(18,17,14);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:2.4rem}
h1{color:rgb(255,255,255);font-size:1.7rem;margin-bottom:10px;letter-spacing:-0.02em}
.fun{color:rgb(239,91,44);font-weight:600;margin-bottom:14px}
p{color:rgb(138,131,124);line-height:1.6;margin-bottom:8px}
a{display:inline-block;margin-top:18px;padding:10px 26px;border-radius:999px;background:rgb(239,91,44);color:rgb(18,17,14);font-weight:600;text-decoration:none}
.hint{font-size:0.85rem;opacity:0.7;margin-top:14px}
</style></head><body><div class="box">
<div class="logo">C</div>
<h1>404 — полка пуста</h1>
<p class="fun">Кот ушёл в запой и не отвечает на звонки.</p>
<p>Сервер CATio временно недоступен.<br>Проверь, что Apache и MySQL запущены в XAMPP.</p>
<a href="http://localhost/itch-steam-like/?client=1">Попробовать снова</a>
<p class="hint">Страница сама обновится через 15 секунд</p>
</div></body></html>)";

const int TOP_HEIGHT = 118;
const int ICON_SIZE_WIN = 16;
const int ICON_SIZE_ARROW = 22;
const int ICON_SIZE_REFRESH = 14;

const COLORREF COL_BG       = RGB(18, 17, 14);
const COLORREF COL_TABROW   = RGB(26, 24, 20);  // фон строки табов = фон кнопок разделов
const COLORREF COL_CARD     = RGB(34, 31, 26);
const COLORREF COL_HOVER    = RGB(46, 42, 36);
const COLORREF COL_BORDER   = RGB(46, 42, 36);
const COLORREF COL_ACCENT   = RGB(239, 91, 44);
const COLORREF COL_TEXT     = RGB(160, 150, 140);
const COLORREF COL_TEXT_BRT = RGB(255, 255, 255);
const COLORREF COL_BODY     = RGB(199, 192, 184);
const COLORREF COL_MUTED    = RGB(138, 131, 124);
const COLORREF COL_URL      = RGB(120, 110, 100);
const COLORREF COL_DISABLED = RGB(80, 75, 70);

#define WM_CATIO_CHECK_DONE (WM_APP + 1)

HWND g_hWnd = nullptr;
HICON g_hLogo = nullptr;
webview::webview* g_webview = nullptr;
std::string g_currentUrl = STORE_URL;
std::string g_balance = "";
std::string g_username = u8"Гость";
bool g_guest = true;

enum class Section { Store, Library, Community, Profile };
Section g_currentSection = Section::Store;

std::vector<std::string> g_history;
int g_historyIndex = -1;
bool g_maximized = false;
RECT g_restoreRect = {};

// Асинхронная проверка сервера (чтобы UI не зависал)
std::atomic<bool> g_checkBusy{ false };
std::string g_pendingUrl;

// Меню под аватаркой
bool g_menuOpen = false;
int g_menuHover = -1;
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

void showOfflinePage() {
    if (!g_webview) return;
    g_webview->navigate(ERROR_HTML);
    g_currentUrl = u8"Сервер недоступен";
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

void layoutWebview() {
    if (!g_hWnd || !g_webview) return;
    RECT rc; GetClientRect(g_hWnd, &rc);
    HWND child = FindWindowExW(g_hWnd, nullptr, nullptr, nullptr);
    while (child) {
        SetWindowPos(child, nullptr, 0, TOP_HEIGHT,
            rc.right, (std::max)(50L, rc.bottom - TOP_HEIGHT), SWP_NOZORDER);
        child = FindWindowExW(g_hWnd, child, nullptr, nullptr);
    }
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
        if (wParam) navigateTo(g_pendingUrl);
        else showOfflinePage();
        break;

    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE && g_menuOpen) {
            g_menuOpen = false;
            InvalidateRect(hWnd, nullptr, FALSE);
        }
        break;

    case WM_PAINT: {
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

        // ===== ROW 1 =====
        int y1 = 18;
        int h1 = 48;

        // Фон строки табов — теперь весь цвета кнопок разделов (#1a1814)
        {
            HBRUSH rowBg = CreateSolidBrush(COL_TABROW);
            RECT rowR = { 0, 0, rc.right, y1 + h1 };
            FillRect(hdc, &rowR, rowBg);
            DeleteObject(rowBg);
        }

        // Logo + CATio
        int logoX = 62;
        if (g_hLogo) {
            DrawIconEx(hdc, logoX, y1 + 4, g_hLogo, 40, 40, 0, nullptr, DI_NORMAL);
            logoX += 52;
        } else {
            HBRUSH br = CreateSolidBrush(COL_ACCENT);
            RECT box = { logoX, y1 + 4, logoX + 40, y1 + 44 };
            FillRect(hdc, &box, br);
            DeleteObject(br);
            drawText(hdc, box, L"C", COL_BG, 20, true, DT_CENTER);
            logoX += 52;
        }
        {
            RECT r = { logoX, y1, logoX + 120, y1 + h1 };
            drawText(hdc, r, L"CATio", COL_ACCENT, 30, true, DT_LEFT);
        }

        // Tabs
        int x = 192;
        auto addTab = [&](const wchar_t* label, int id, bool active, int w) {
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, id });
            COLORREF col = active ? COL_ACCENT : (hoverId == id ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, label, col, 20, true, DT_CENTER);
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
        addTab(L"КАТАЛОГ",    ID_STORE,     g_currentSection == Section::Store,     120);
        addTab(L"БИБЛИОТЕКА", ID_LIBRARY,   g_currentSection == Section::Library,   135);
        addTab(L"МАСТЕРСКАЯ", ID_COMMUNITY, g_currentSection == Section::Community, 135);

        {
            // У гостя вместо ника — кнопка ВОЙТИ
            std::wstring nickUp = g_guest ? L"ВОЙТИ" : toUpperW(g_username);
            int w = 100;
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, ID_PROFILE });
            bool active = g_currentSection == Section::Profile && !g_guest;
            COLORREF col = active ? COL_ACCENT : (hoverId == ID_PROFILE ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, nickUp.c_str(), col, 20, true, DT_CENTER);
            if (active) {
                HPEN p2 = CreatePen(PS_SOLID, 3, COL_ACCENT);
                HPEN o2 = (HPEN)SelectObject(hdc, p2);
                MoveToEx(hdc, r.left + 6, r.bottom - 2, nullptr);
                LineTo(hdc, r.right - 6, r.bottom - 2);
                SelectObject(hdc, o2);
                DeleteObject(p2);
            }
        }

        // Right side: window buttons
        int rx = rc.right - 12;
        auto addWinBtn = [&](const IconSet& ico, int id) {
            RECT r = { rx - 36, y1, rx, y1 + h1 };
            g_buttons.push_back({ r, id });
            DrawIconCentered(hdc, ico, r, ICON_SIZE_WIN, hoverId == id);
            rx -= 40;
        };
        addWinBtn(g_icoClose, ID_CLOSE);
        addWinBtn(g_maximized ? g_icoRestore : g_icoMaximize, ID_MAX);
        addWinBtn(g_icoMinimiz, ID_MIN);

        // Avatar (кликабельная — открывает меню)
        int av = 32;
        int avX = rx - av - 6;
        int avY = y1 + (h1 - av) / 2;
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
        drawText(hdc, rAv, avLetter.c_str(), COL_BG, 14, true, DT_CENTER);
        rx = avX - 10;

        // Username
        if (!g_guest) {
            std::wstring nick = toWide(g_username);
            RECT r = { rx - 80, y1, rx, y1 + h1 };
            drawText(hdc, r, nick.c_str(), COL_TEXT_BRT, 16, false, DT_RIGHT);
            rx -= 90;
            std::wstring bal = toWide(g_balance);
            RECT rb = { rx - 100, y1, rx, y1 + h1 };
            drawText(hdc, rb, bal.c_str(), COL_ACCENT, 16, true, DT_RIGHT);
        }

        // ===== МЕНЮ ПОД АВАТАРКОЙ =====
        if (g_menuOpen && !g_guest) {
            const int mw = 230;
            const int hh = 56, ih = 42;
            int mx = g_avatarRect.right - mw;
            if (mx < 8) mx = 8;
            int my = g_avatarRect.bottom + 8;
            RECT m = { mx, my, mx + mw, my + hh + 1 + ih * 2 };
            g_menuRect = m;

            HBRUSH mbg = CreateSolidBrush(COL_CARD);
            FillRect(hdc, &m, mbg);
            DeleteObject(mbg);
            HBRUSH bbr = CreateSolidBrush(COL_BORDER);
            FrameRect(hdc, &m, bbr);
            DeleteObject(bbr);

            g_menuItems.clear();

            // Шапка: баланс
            RECT hR = { mx + 14, my, mx + mw - 14, my + hh };
            g_menuItems.push_back({ hR, 0 });
            RECT l1 = { hR.left, hR.top + 6, hR.right, hR.top + 24 };
            drawText(hdc, l1, L"Баланс", COL_MUTED, 12, false, DT_LEFT);
            RECT l2 = { hR.left, hR.top + 22, hR.right, hR.top + 50 };
            std::wstring bal = toWide(g_balance.empty() ? "0 \xE2\x82\xBD" : g_balance);
            drawText(hdc, l2, bal.c_str(), COL_ACCENT, 16, true, DT_LEFT);

            HPEN sep = CreatePen(PS_SOLID, 1, COL_BORDER);
            HPEN os = (HPEN)SelectObject(hdc, sep);
            MoveToEx(hdc, mx, my + hh, nullptr);
            LineTo(hdc, mx + mw, my + hh);
            SelectObject(hdc, os);
            DeleteObject(sep);

            struct Item { const wchar_t* txt; int id; bool danger; };
            Item items[] = { { L"Настройки", 1, false }, { L"Выйти", 2, true } };
            int iy = my + hh + 1;
            for (auto& it : items) {
                RECT r = { mx, iy, mx + mw, iy + ih };
                g_menuItems.push_back({ r, it.id });
                if (g_menuHover == it.id) {
                    HBRUSH hb = CreateSolidBrush(COL_HOVER);
                    FillRect(hdc, &r, hb);
                    DeleteObject(hb);
                }
                RECT tr = { r.left + 14, r.top, r.right - 14, r.bottom };
                COLORREF col = (g_menuHover == it.id && it.danger) ? COL_ACCENT : COL_BODY;
                drawText(hdc, tr, it.txt, col, 14, false, DT_LEFT);
                iy += ih;
            }
        }

        // ===== ROW 2: arrows under logo + refresh + url =====
        int y2 = 78;
        int h2 = 28;

        int ax = 57;
        bool canBack    = g_historyIndex > 0;
        bool canForward = g_historyIndex + 1 < (int)g_history.size();

        {
            RECT r = { ax, y2, ax + 26, y2 + h2 };
            g_buttons.push_back({ r, ID_BACK });
            DrawIconCentered(hdc, g_icoBack, r, ICON_SIZE_ARROW, hoverId == ID_BACK && canBack, canBack);
            ax += 26;
        }
        {
            RECT r = { ax, y2, ax + 26, y2 + h2 };
            g_buttons.push_back({ r, ID_FORWARD });
            DrawIconCentered(hdc, g_icoForward, r, ICON_SIZE_ARROW, hoverId == ID_FORWARD && canForward, canForward);
            ax += 30;
        }
        {
            RECT r = { ax, y2, ax + 24, y2 + h2 };
            g_buttons.push_back({ r, ID_REFRESH });
            DrawIconCentered(hdc, g_icoRefresh, r, ICON_SIZE_REFRESH, hoverId == ID_REFRESH, true);
            ax += 28;
        }

        x = ax + 8;

        std::wstring urlW = toWide(g_currentUrl);
        size_t p = urlW.find(L"?client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);
        p = urlW.find(L"&client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);

        HFONT fUrl = CreateFontW(13, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0,
            DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
        HFONT oldF = (HFONT)SelectObject(hdc, fUrl);
        SIZE sz = {};
        GetTextExtentPoint32W(hdc, urlW.c_str(), (int)urlW.size(), &sz);
        SelectObject(hdc, oldF);
        DeleteObject(fUrl);

        int urlWpx = sz.cx + 4;
        RECT rUrl = { x, y2, x + urlWpx, y2 + h2 };
        g_buttons.push_back({ rUrl, ID_URL });
        drawText(hdc, rUrl, urlW.c_str(), hoverId == ID_URL ? COL_ACCENT : COL_URL, 13, false, DT_LEFT);

        EndPaint(hWnd, &ps);
        break;
    }

    case WM_LBUTTONDOWN: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);

        // Меню открыто — клики обрабатывает оно
        if (g_menuOpen) {
            bool inside = false;
            for (const auto& mi : g_menuItems) {
                if (mx >= mi.rc.left && mx <= mi.rc.right && my >= mi.rc.top && my <= mi.rc.bottom) {
                    inside = true;
                    if (mi.id == 1) {
                        g_menuOpen = false;
                        InvalidateRect(hWnd, nullptr, FALSE);
                        MessageBoxW(hWnd, u8"Настройки скоро появятся. Кот ещё их пакует.", L"CATio", MB_OK | MB_ICONINFORMATION);
                    } else if (mi.id == 2) {
                        g_menuOpen = false;
                        InvalidateRect(hWnd, nullptr, FALSE);
                        // Выход через JS страницы (разлогинит и перекинет в каталог)
                        if (g_webview) g_webview->eval("try{logout()}catch(e){}");
                    }
                    break;
                }
            }
            if (!inside) {
                g_menuOpen = false;
                InvalidateRect(hWnd, nullptr, FALSE);
            }
            return 0;
        }

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
                        if (!g_guest) {
                            g_menuOpen = !g_menuOpen;
                            g_menuHover = -1;
                            InvalidateRect(hWnd, nullptr, FALSE);
                        }
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
                    case ID_MIN: ShowWindow(hWnd, SW_MINIMIZE); break;
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
    MARGINS m = { 0, 0, 0, 0 };
    DwmExtendFrameIntoClientArea(g_hWnd, &m);

    ShowWindow(g_hWnd, nShow);
    UpdateWindow(g_hWnd);

    try {
        g_webview = new webview::webview(true, g_hWnd);
        layoutWebview();

        // Синхронизация с веб-страницей: имя, баланс, гость/не гость.
        // Страница (index.php) шлёт AUTH_STATE через catioSync.
        g_webview->bind("catioSync", [](const std::string& req) -> std::string {
            bool auth = req.find("\"authorized\":true") != std::string::npos
                     || req.find("\"authorized\": true") != std::string::npos;
            g_guest = !auth;
            std::string name = jsonExtractStr(req, "username");
            if (name.empty()) name = u8"Гость";
            g_username = name;
            g_balance = auth ? formatBalance(jsonExtractInt(req, "balance")) : "";
            if (g_hWnd) InvalidateRect(g_hWnd, nullptr, FALSE);
            return "";
        });

        // Проверка сервера в фоне — окно не виснет на старте
        checkServerAsync(STORE_URL);
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
