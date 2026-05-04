#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use actix_web::{App, HttpRequest, HttpResponse, HttpServer, web};
use mime_guess::from_path;
use reqwest::Client;
use rust_embed::Embed;
use std::net::TcpListener;
use std::sync::RwLock;

const VERSION: &str = "1.0.0";
const HOST: &str = "127.0.0.1";
const PORT: u16 = 3847;
const DEFAULT_RPC: &str = "https://api.mainnet-beta.solana.com";
const MAX_REQUEST_BYTES: usize = 65_536;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const RPC_TIMEOUT_SECS: u64 = 30;
const SHUTDOWN_DELAY_MS: u64 = 500;

#[derive(Embed)]
#[folder = "frontend/"]
struct FrontendAssets;

struct AppState {
    rpc_url: RwLock<String>,
    http: Client,
}

async fn rpc_proxy(body: web::Bytes, data: web::Data<AppState>) -> HttpResponse {
    if body.len() > MAX_REQUEST_BYTES {
        return HttpResponse::PayloadTooLarge()
            .json(serde_json::json!({"error": "Request body too large"}));
    }

    let rpc_url = data.rpc_url.read().unwrap().clone();

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
            let response_body = resp.bytes().await.unwrap_or_default();
            if response_body.len() > MAX_RESPONSE_BYTES {
                return HttpResponse::BadGateway()
                    .json(serde_json::json!({"error": "RPC response too large"}));
            }
            HttpResponse::Ok()
                .content_type("application/json")
                .body(response_body)
        }
        Err(_e) => HttpResponse::BadGateway().json(serde_json::json!({
            "error": "RPC request failed. Check your RPC URL in Settings."
        })),
    }
}

async fn set_rpc(body: web::Json<serde_json::Value>, data: web::Data<AppState>) -> HttpResponse {
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
            || url_lower.contains("172.2")
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

        let mut rpc = data.rpc_url.write().unwrap();
        *rpc = url.to_string();
        HttpResponse::Ok().json(serde_json::json!({"ok": true}))
    } else {
        HttpResponse::BadRequest().json(serde_json::json!({"error": "Missing rpc_url"}))
    }
}

async fn shutdown(req: HttpRequest) -> HttpResponse {
    if let Some(origin) = req.headers().get("origin") {
        let o = origin.to_str().unwrap_or("");
        if o != format!("http://{}:{}", HOST, PORT) && o != format!("http://localhost:{}", PORT) {
            return HttpResponse::Forbidden().json(serde_json::json!({"error": "Forbidden"}));
        }
    }
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(SHUTDOWN_DELAY_MS)).await;
        std::process::exit(0);
    });
    HttpResponse::Ok().json(serde_json::json!({"ok": true, "message": "Shutting down..."}))
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

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let addr = format!("{}:{}", HOST, PORT);

    if TcpListener::bind(&addr).is_err() {
        eprintln!(
            "Port {} already in use — is another instance running?",
            PORT
        );
        eprintln!("Open http://{}:{} in your browser.", HOST, PORT);
        std::process::exit(1);
    }

    let url = format!("http://{}:{}", HOST, PORT);
    println!("Zarix Local v{} — http://{}:{}", VERSION, HOST, PORT);

    if let Err(e) = open::that(&url) {
        eprintln!("Could not open browser: {} — open {} manually", e, url);
    }

    let app_state = web::Data::new(AppState {
        rpc_url: RwLock::new(DEFAULT_RPC.to_string()),
        http: Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http client"),
    });

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/api/rpc", web::post().to(rpc_proxy))
            .route("/api/rpc/set", web::post().to(set_rpc))
            .route("/api/shutdown", web::post().to(shutdown))
            .route("/api/ping", web::get().to(ping))
            .route("/{filename:.*}", web::get().to(serve_embedded))
    })
    .bind(&addr)?
    .run()
    .await
}
