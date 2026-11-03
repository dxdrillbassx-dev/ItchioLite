// CATio - Frameless launcher
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <winhttp.h>
#include <dwmapi.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>

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

const wchar_t* APP_TITLE = L"CATio";
const char* STORE_URL     = "http://localhost/itch-steam-like/?client=1";
const char* LIBRARY_URL   = "http://localhost/itch-steam-like/?view=library&client=1";
const char* COMMUNITY_URL = "http://localhost/itch-steam-like/?view=community&client=1";
const char* PROFILE_URL   = "http://localhost/itch-steam-like/?view=profile&client=1";

const char* ERROR_HTML = R"(data:text/html,<!DOCTYPE html><html><head><meta charset=utf-8>
<style>body{margin:0;background:#12110e;color:#c7c0b8;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}
.box{max-width:480px;padding:40px}h1{color:#fff;font-size:1.6rem}p{color:#8a837c;line-height:1.5}
code{background:#221f1a;padding:2px 6px;border-radius:4px;color:#ef5b2c}</style></head><body><div class=box>
<h1>Не удалось подключиться</h1>
<p>Проверь Apache в XAMPP и папку<br><code>C:\xampp\htdocs\itch-steam-like\</code></p>
</div></body></html>)";

const int TOP_HEIGHT = 84;

const COLORREF COL_BG       = RGB(18, 17, 14);
const COLORREF COL_ACCENT   = RGB(239, 91, 44);
const COLORREF COL_TEXT     = RGB(180, 170, 160);
const COLORREF COL_TEXT_BRT = RGB(255, 255, 255);
const COLORREF COL_URL      = RGB(120, 110, 100);

HWND g_hWnd = nullptr;
HICON g_hLogo = nullptr;
webview::webview* g_webview = nullptr;
std::string g_currentUrl = STORE_URL;
std::string g_balance = "7 501 ₽";
std::string g_username = "admin"; // original case for right side

enum class Section { Store, Library, Community, Profile };
Section g_currentSection = Section::Store;

std::vector<std::string> g_history;
int g_historyIndex = -1;
bool g_maximized = false;
RECT g_restoreRect = {};

struct Btn { RECT rc; int id; };
std::vector<Btn> g_buttons;

enum {
    ID_BACK=1, ID_FORWARD, ID_REFRESH,
    ID_STORE, ID_LIBRARY, ID_COMMUNITY, ID_PROFILE,
    ID_URL, ID_MIN, ID_MAX, ID_CLOSE
};

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

bool checkServer() {
    HINTERNET s = WinHttpOpen(L"CATio/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!s) return false;
    HINTERNET c = WinHttpConnect(s, L"localhost", 80, 0);
    if (!c) { WinHttpCloseHandle(s); return false; }
    HINTERNET r = WinHttpOpenRequest(c, L"GET", L"/itch-steam-like/", nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
    if (!r) { WinHttpCloseHandle(c); WinHttpCloseHandle(s); return false; }
    DWORD t = 2000;
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

void doRefresh() {
    if (!checkServer()) {
        g_webview->navigate(ERROR_HTML);
        g_currentUrl = "Ошибка подключения";
        InvalidateRect(g_hWnd, nullptr, FALSE);
        return;
    }
    switch (g_currentSection) {
        case Section::Store:     navigateTo(STORE_URL); break;
        case Section::Library:   navigateTo(LIBRARY_URL); break;
        case Section::Community: navigateTo(COMMUNITY_URL); break;
        case Section::Profile:   navigateTo(PROFILE_URL); break;
    }
}

void switchSection(Section s) {
    g_currentSection = s;
    if (!checkServer()) {
        g_webview->navigate(ERROR_HTML);
        g_currentUrl = "Ошибка подключения";
    } else {
        switch (s) {
            case Section::Store:     navigateTo(STORE_URL); break;
            case Section::Library:   navigateTo(LIBRARY_URL); break;
            case Section::Community: navigateTo(COMMUNITY_URL); break;
            case Section::Profile:   navigateTo(PROFILE_URL); break;
        }
    }
    InvalidateRect(g_hWnd, nullptr, TRUE);
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

// Load logo.ico next to exe
void loadLogo() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    // strip exe name
    wchar_t* slash = wcsrchr(path, L'\\');
    if (slash) *(slash + 1) = 0;
    wcscat(path, L"logo.ico");
    g_hLogo = (HICON)LoadImageW(nullptr, path, IMAGE_ICON, 28, 28, LR_LOADFROMFILE | LR_DEFAULTSIZE);
    if (!g_hLogo) {
        // try client folder relative
        g_hLogo = (HICON)LoadImageW(nullptr, L"logo.ico", IMAGE_ICON, 28, 28, LR_LOADFROMFILE);
    }
}

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
        int y1 = 6, h1 = 34, x = 12;

        // Logo + CATio
        if (g_hLogo) {
            DrawIconEx(hdc, x, y1 + 3, g_hLogo, 28, 28, 0, nullptr, DI_NORMAL);
            x += 34;
        } else {
            // fallback orange square with C
            HBRUSH br = CreateSolidBrush(COL_ACCENT);
            RECT box = { x, y1 + 3, x + 28, y1 + 31 };
            FillRect(hdc, &box, br);
            DeleteObject(br);
            drawText(hdc, box, L"C", COL_BG, 14, true, DT_CENTER);
            x += 34;
        }
        {
            RECT r = { x, y1, x + 70, y1 + h1 };
            drawText(hdc, r, L"CATio", COL_ACCENT, 20, true, DT_LEFT);
            x += 80;
        }
        x += 10;

        auto addTab = [&](const wchar_t* label, int id, bool active, int w) {
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, id });
            COLORREF col = active ? COL_ACCENT : (hoverId == id ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, label, col, 16, true, DT_CENTER);
            if (active) {
                HPEN p2 = CreatePen(PS_SOLID, 3, COL_ACCENT);
                HPEN o2 = (HPEN)SelectObject(hdc, p2);
                MoveToEx(hdc, r.left + 6, r.bottom - 1, nullptr);
                LineTo(hdc, r.right - 6, r.bottom - 1);
                SelectObject(hdc, o2);
                DeleteObject(p2);
            }
            x += w + 6;
        };
        addTab(L"МАГАЗИН",    ID_STORE,     g_currentSection == Section::Store,     110);
        addTab(L"БИБЛИОТЕКА", ID_LIBRARY,   g_currentSection == Section::Library,   125);
        addTab(L"СООБЩЕСТВО", ID_COMMUNITY, g_currentSection == Section::Community, 125);

        // nickname tab ALWAYS UPPERCASE
        {
            std::wstring nickUp = toUpperW(g_username);
            int w = 90;
            RECT r = { x, y1, x + w, y1 + h1 };
            g_buttons.push_back({ r, ID_PROFILE });
            bool active = g_currentSection == Section::Profile;
            COLORREF col = active ? COL_ACCENT : (hoverId == ID_PROFILE ? COL_TEXT_BRT : COL_TEXT);
            drawText(hdc, r, nickUp.c_str(), col, 16, true, DT_CENTER);
            if (active) {
                HPEN p2 = CreatePen(PS_SOLID, 3, COL_ACCENT);
                HPEN o2 = (HPEN)SelectObject(hdc, p2);
                MoveToEx(hdc, r.left + 6, r.bottom - 1, nullptr);
                LineTo(hdc, r.right - 6, r.bottom - 1);
                SelectObject(hdc, o2);
                DeleteObject(p2);
            }
        }

        // right: balance, nick (original case), avatar, window btns
        int rx = rc.right - 8;
        auto addWinBtn = [&](const wchar_t* t, int id) {
            RECT r = { rx - 34, y1, rx, y1 + h1 };
            g_buttons.push_back({ r, id });
            COLORREF col = COL_TEXT;
            if (hoverId == id) col = (id == ID_CLOSE) ? RGB(255, 80, 80) : COL_ACCENT;
            drawText(hdc, r, t, col, 15, true, DT_CENTER);
            rx -= 38;
        };
        addWinBtn(L"✕", ID_CLOSE);
        addWinBtn(g_maximized ? L"❐" : L"□", ID_MAX);
        addWinBtn(L"—", ID_MIN);

        int av = 26;
        int avX = rx - av - 4;
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
        // first letter of username upper for avatar
        std::wstring avLetter = toUpperW(g_username.substr(0, 1));
        drawText(hdc, rAv, avLetter.c_str(), COL_BG, 12, true, DT_CENTER);
        rx = avX - 8;

        // nick original case
        {
            std::wstring nick = toWide(g_username);
            RECT r = { rx - 64, y1, rx, y1 + h1 };
            drawText(hdc, r, nick.c_str(), COL_TEXT_BRT, 13, false, DT_RIGHT);
            rx -= 70;
        }
        {
            std::wstring bal = toWide(g_balance);
            RECT r = { rx - 80, y1, rx, y1 + h1 };
            drawText(hdc, r, bal.c_str(), COL_ACCENT, 13, true, DT_RIGHT);
        }

        // ===== ROW 2: arrows + refresh + url =====
        int y2 = 46, h2 = 28;
        x = 10;

        auto addSmall = [&](const wchar_t* t, int id, int w) {
            RECT r = { x, y2, x + w, y2 + h2 };
            g_buttons.push_back({ r, id });
            COLORREF col = (hoverId == id) ? COL_ACCENT : COL_TEXT;
            drawText(hdc, r, t, col, 16, true, DT_CENTER);
            x += w + 4;
        };
        addSmall(L"←", ID_BACK, 32);
        addSmall(L"→", ID_FORWARD, 32);
        addSmall(L"↻", ID_REFRESH, 32);
        x += 10;

        std::wstring urlW = toWide(g_currentUrl);
        size_t p = urlW.find(L"?client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);
        p = urlW.find(L"&client=1");
        if (p != std::wstring::npos) urlW = urlW.substr(0, p);

        RECT rUrl = { x, y2, rc.right - 16, y2 + h2 };
        g_buttons.push_back({ rUrl, ID_URL });
        drawText(hdc, rUrl, urlW.c_str(), hoverId == ID_URL ? COL_ACCENT : COL_URL, 13, false, DT_LEFT);

        EndPaint(hWnd, &ps);
        break;
    }

    case WM_LBUTTONDOWN: {
        int mx = GET_X_LPARAM(lParam);
        int my = GET_Y_LPARAM(lParam);
        for (const auto& b : g_buttons) {
            if (mx >= b.rc.left && mx <= b.rc.right && my >= b.rc.top && my <= b.rc.bottom) {
                switch (b.id) {
                    case ID_BACK: goBack(); break;
                    case ID_FORWARD: goForward(); break;
                    case ID_REFRESH: doRefresh(); break;
                    case ID_STORE: switchSection(Section::Store); break;
                    case ID_LIBRARY: switchSection(Section::Library); break;
                    case ID_COMMUNITY: switchSection(Section::Community); break;
                    case ID_PROFILE: switchSection(Section::Profile); break;
                    case ID_URL:
                        copyToClipboard(g_currentUrl);
                        MessageBoxW(hWnd, L"Ссылка скопирована", L"CATio", MB_OK | MB_ICONINFORMATION);
                        break;
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
        if (hoverId != old) {
            RECT top = { 0, 0, 8000, TOP_HEIGHT };
            InvalidateRect(hWnd, &top, FALSE);
        }
        break;
    }

    case WM_ERASEBKGND: return 1;
    case WM_DESTROY:
        if (g_hLogo) { DestroyIcon(g_hLogo); g_hLogo = nullptr; }
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
        if (checkServer()) navigateTo(STORE_URL);
        else {
            g_webview->navigate(ERROR_HTML);
            g_currentUrl = "Ошибка подключения";
            InvalidateRect(g_hWnd, nullptr, FALSE);
        }
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
