#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use actix_web::{App, HttpRequest, HttpResponse, HttpServer, web};
use mime_guess::from_path;
use reqwest::Client;
use rust_embed::Embed;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::{Duration, Instant};

const VERSION: &str = "1.1.4";
const HOST: &str = "127.0.0.1";
const PORT: u16 = 3847;
const DEFAULT_RPC: &str = "https://api.mainnet-beta.solana.com";
const MAX_REQUEST_BYTES: usize = 65_536;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const RPC_TIMEOUT_SECS: u64 = 30;
const SHUTDOWN_FORCE_DELAY_MS: u64 = 500;
const SHUTDOWN_GRACE_DELAY_MS: u64 = 3000;
const HEARTBEAT_TIMEOUT_SECS: u64 = 45;
const STARTUP_IDLE_TIMEOUT_SECS: u64 = 300;
const PORT_RETRY_ATTEMPTS: u32 = 6;
const PORT_RETRY_WAIT_MS: u64 = 800;

#[derive(Embed)]
#[folder = "frontend/"]
struct FrontendAssets;

struct AppState {
    rpc_url: RwLock<String>,
    http: Client,
    last_heartbeat: RwLock<Option<Instant>>,
    started_at: Instant,
    shutdown_generation: AtomicU64,
}

fn is_valid_origin(req: &HttpRequest) -> bool {
    match req.headers().get("origin") {
        Some(origin) => {
            let o = origin.to_str().unwrap_or("");
            o == format!("http://{}:{}", HOST, PORT) || o == format!("http://localhost:{}", PORT)
        }
        None => {
            // Allow requests with no Origin header only if Referer matches
            // (same-origin XHR from app mode won't always send Origin)
            match req.headers().get("referer") {
                Some(referer) => {
                    let r = referer.to_str().unwrap_or("");
                    r.starts_with(&format!("http://{}:{}", HOST, PORT))
                        || r.starts_with(&format!("http://localhost:{}", PORT))
                }
                None => false,
            }
        }
    }
}

fn rpc_upstream_error(message: &str) -> HttpResponse {
    // Return JSON-RPC error shape with HTTP 200 so solana-web3 surfaces `message`
    // instead of a generic fetch/HTTP failure.
    HttpResponse::Ok()
        .content_type("application/json")
        .json(serde_json::json!({
            "jsonrpc": "2.0",
            "error": { "code": -32005, "message": message },
            "id": null
        }))
}

async fn rpc_proxy(req: HttpRequest, body: web::Bytes, data: web::Data<AppState>) -> HttpResponse {
    if !is_valid_origin(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({"error": "Forbidden"}));
    }

    if body.len() > MAX_REQUEST_BYTES {
        return HttpResponse::PayloadTooLarge()
            .json(serde_json::json!({"error": "Request body too large"}));
    }

    let rpc_url = data
        .rpc_url
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    match data
        .http
        .post(&rpc_url)
        .header("Content-Type", "application/json")
        .body(body.to_vec())
        .timeout(std::time::Duration::from_secs(RPC_TIMEOUT_SECS))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if status.as_u16() == 429 {
                return rpc_upstream_error(
                    "RPC rate limited (429). Wait a moment or switch to Helius/QuickNode in Settings.",
                );
            }
            if status.is_server_error() {
                return rpc_upstream_error(&format!(
                    "RPC server error ({}). Check your RPC URL or try again.",
                    status.as_u16()
                ));
            }
            let response_body = resp.bytes().await.unwrap_or_default();
            if response_body.len() > MAX_RESPONSE_BYTES {
                return rpc_upstream_error("RPC response too large");
            }
            HttpResponse::Ok()
                .content_type("application/json")
                .body(response_body)
        }
        Err(e) => {
            let error = if e.is_timeout() {
                "RPC timed out. Check your internet or try another RPC in Settings."
            } else if e.is_connect() {
                "Could not reach RPC. Check internet or your RPC URL in Settings."
            } else if e.is_request() {
                "RPC request failed. Check your RPC URL in Settings."
            } else {
                "RPC request failed. Check your internet and RPC URL in Settings."
            };
            rpc_upstream_error(error)
        }
    }
}

async fn set_rpc(
    req: HttpRequest,
    body: web::Json<serde_json::Value>,
    data: web::Data<AppState>,
) -> HttpResponse {
    if !is_valid_origin(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({"error": "Forbidden"}));
    }

    if let Some(url) = body.get("rpc_url").and_then(|v| v.as_str()) {
        let url_lower = url.to_lowercase();

        if url_lower.starts_with("file:")
            || url_lower.starts_with("ftp:")
            || url_lower.starts_with("data:")
            || url_lower.starts_with("javascript:")
        {
            return HttpResponse::BadRequest().json(
                serde_json::json!({"error": "Invalid URL scheme. Only HTTPS URLs are allowed."}),
            );
        }

        let is_private = url_lower.contains("localhost")
            || url_lower.contains("127.0.0.")
            || url_lower.contains("0.0.0.0")
            || url_lower.contains("[::1]")
            || url_lower.starts_with("https://10.")
            || url_lower.starts_with("http://10.")
            || url_lower.contains("192.168.")
            || url_lower.contains("172.16.")
            || url_lower.contains("172.17.")
            || url_lower.contains("172.18.")
            || url_lower.contains("172.19.")
            || url_lower.contains("172.20.")
            || url_lower.contains("172.21.")
            || url_lower.contains("172.22.")
            || url_lower.contains("172.23.")
            || url_lower.contains("172.24.")
            || url_lower.contains("172.25.")
            || url_lower.contains("172.26.")
            || url_lower.contains("172.27.")
            || url_lower.contains("172.28.")
            || url_lower.contains("172.29.")
            || url_lower.contains("172.30.")
            || url_lower.contains("172.31.")
            || url_lower.contains("169.254.");

        if is_private {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({"error": "Private/internal URLs are not allowed."}));
        }

        let is_solana_public = url_lower == "https://api.mainnet-beta.solana.com";
        if !url_lower.starts_with("https://") && !is_solana_public {
            return HttpResponse::BadRequest().json(
                serde_json::json!({"error": "Only HTTPS RPC URLs are allowed for security."}),
            );
        }

        let mut rpc = data.rpc_url.write().unwrap_or_else(|e| e.into_inner());
        *rpc = url.to_string();
        HttpResponse::Ok().json(serde_json::json!({"ok": true}))
    } else {
        HttpResponse::BadRequest().json(serde_json::json!({"error": "Missing rpc_url"}))
    }
}

fn schedule_shutdown(data: web::Data<AppState>, force: bool) {
    let delay_ms = if force {
        SHUTDOWN_FORCE_DELAY_MS
    } else {
        SHUTDOWN_GRACE_DELAY_MS
    };
    let generation = data.shutdown_generation.fetch_add(1, Ordering::SeqCst) + 1;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        if data.shutdown_generation.load(Ordering::SeqCst) == generation {
            std::process::exit(0);
        }
    });
}

async fn shutdown(req: HttpRequest, data: web::Data<AppState>) -> HttpResponse {
    if !is_valid_origin(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({"error": "Forbidden"}));
    }
    let force = req
        .query_string()
        .split('&')
        .any(|part| part == "force=1" || part == "force=true");
    schedule_shutdown(data, force);
    HttpResponse::Ok().json(serde_json::json!({"ok": true, "message": "Shutting down..."}))
}

async fn heartbeat(req: HttpRequest, data: web::Data<AppState>) -> HttpResponse {
    if !is_valid_origin(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({"error": "Forbidden"}));
    }
    data.shutdown_generation.fetch_add(1, Ordering::SeqCst);
    *data
        .last_heartbeat
        .write()
        .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    HttpResponse::Ok().json(serde_json::json!({"ok": true, "version": VERSION}))
}

async fn ping() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "ok", "version": VERSION}))
}

async fn serve_embedded(req: HttpRequest) -> HttpResponse {
    let path = req.match_info().query("filename");
    let path = if path.is_empty() || path == "/" {
        "index.html"
    } else {
        path
    };

    if path.contains("..") || path.contains("//") {
        return HttpResponse::Forbidden().body("403 Forbidden");
    }

    match FrontendAssets::get(path) {
        Some(content) => {
            let mime = from_path(path).first_or_octet_stream();
            HttpResponse::Ok()
                .content_type(mime.as_ref())
                .insert_header(("X-Frame-Options", "DENY"))
                .insert_header(("X-Content-Type-Options", "nosniff"))
                .insert_header(("Referrer-Policy", "no-referrer"))
                .insert_header((
                    "Permissions-Policy",
                    "camera=(), microphone=(), geolocation=()",
                ))
                .body(content.data.into_owned())
        }
        None => match FrontendAssets::get("index.html") {
            Some(content) => HttpResponse::Ok()
                .content_type("text/html")
                .insert_header(("X-Frame-Options", "DENY"))
                .insert_header(("X-Content-Type-Options", "nosniff"))
                .body(content.data.into_owned()),
            None => HttpResponse::NotFound().body("404 Not Found"),
        },
    }
}

fn find_browser() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
        // Try PATH-based lookup on Windows
        for cmd in &["chrome", "msedge", "brave"] {
            if std::process::Command::new("where")
                .arg(cmd)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(cmd.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let app_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for path in &app_paths {
            if std::path::Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let commands = [
            "google-chrome",
            "google-chrome-stable",
            "chromium-browser",
            "chromium",
            "microsoft-edge",
            "brave-browser",
        ];
        for cmd in &commands {
            if std::process::Command::new("which")
                .arg(cmd)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(cmd.to_string());
            }
        }
    }

    None
}

fn request_remote_shutdown(force: bool) {
    let path = if force {
        "/api/shutdown?force=1"
    } else {
        "/api/shutdown"
    };
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nOrigin: http://{HOST}:{PORT}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    if let Ok(mut stream) = std::net::TcpStream::connect(format!("{HOST}:{PORT}")) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let _ = stream.write_all(request.as_bytes());
        let _ = stream.shutdown(std::net::Shutdown::Both);
    }
}

fn acquire_port(addr: &str) -> bool {
    for attempt in 0..PORT_RETRY_ATTEMPTS {
        match TcpListener::bind(addr) {
            Ok(listener) => {
                drop(listener);
                return true;
            }
            Err(_) if attempt + 1 < PORT_RETRY_ATTEMPTS => {
                request_remote_shutdown(true);
                std::thread::sleep(Duration::from_millis(PORT_RETRY_WAIT_MS));
            }
            Err(_) => return false,
        }
    }
    false
}

fn spawn_idle_watchdog(data: web::Data<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            let last = data
                .last_heartbeat
                .read()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(last_seen) = *last {
                if last_seen.elapsed() > Duration::from_secs(HEARTBEAT_TIMEOUT_SECS) {
                    std::process::exit(0);
                }
            } else if data.started_at.elapsed() > Duration::from_secs(STARTUP_IDLE_TIMEOUT_SECS) {
                std::process::exit(0);
            }
        }
    });
}

fn wait_until_ready(addr: &str) {
    for attempt in 0..80 {
        if TcpStream::connect(addr).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
        if attempt == 79 {
            eprintln!(
                "Warning: local server not reachable at {} before opening the window.",
                addr
            );
        }
    }
}

fn launch_app_window(url: &str) {
    if let Some(browser) = find_browser() {
        let app_flag = format!("--app={}", url);
        let result = std::process::Command::new(&browser)
            .args([&app_flag, "--window-size=1024,680", "--new-window"])
            .spawn();

        match result {
            Ok(_) => {
                println!("Launched in app mode ✓");
                return;
            }
            Err(e) => {
                eprintln!("App mode failed ({}), falling back to browser...", e);
            }
        }
    } else {
        eprintln!("No Chrome/Edge found — opening in default browser...");
    }

    // Fallback to default browser
    if let Err(e) = open::that(url) {
        eprintln!("Could not open browser: {} — open {} manually", e, url);
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let addr = format!("{}:{}", HOST, PORT);

    if !acquire_port(&addr) {
        eprintln!(
            "Port {} is still in use — close the other Zarix Local instance and try again.",
            PORT
        );
        std::process::exit(1);
    }

    let url = format!("http://{}:{}", HOST, PORT);
    println!("Zarix Local v{} — http://{}:{}", VERSION, HOST, PORT);

    let app_state = web::Data::new(AppState {
        rpc_url: RwLock::new(DEFAULT_RPC.to_string()),
        http: Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http client"),
        last_heartbeat: RwLock::new(None),
        started_at: Instant::now(),
        shutdown_generation: AtomicU64::new(0),
    });

    spawn_idle_watchdog(app_state.clone());

    // Actix only listens once the Server future is polled — spawn first, then open browser.
    let server = HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/api/rpc", web::post().to(rpc_proxy))
            .route("/api/rpc/set", web::post().to(set_rpc))
            .route("/api/shutdown", web::post().to(shutdown))
            .route("/api/heartbeat", web::post().to(heartbeat))
            .route("/api/ping", web::get().to(ping))
            .route("/{filename:.*}", web::get().to(serve_embedded))
    })
    .bind(&addr)?
    .run();

    let server_task = actix_web::rt::spawn(async move {
        if let Err(e) = server.await {
            eprintln!("Server error: {}", e);
            std::process::exit(1);
        }
    });

    wait_until_ready(&addr);
    launch_app_window(&url);

    server_task
        .await
        .map_err(|e| std::io::Error::other(format!("server task failed: {e}")))?;
    Ok(())
}
