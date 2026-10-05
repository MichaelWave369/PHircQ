use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

const SERVICE_TYPE: &str = "_phircq._tcp.local.";
const PROBE_SCHEMA: &str = "phircq.native-probe.v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeInfo {
    native: bool,
    instance_id: String,
    service_type: String,
    running: bool,
    probe_port: Option<u16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LanPeer {
    peer_id: String,
    display_name: String,
    fullname: String,
    hostname: String,
    addresses: Vec<String>,
    port: u16,
    version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LanProbeResult {
    peer_id: String,
    address: Option<String>,
    port: u16,
    reachable: bool,
    detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProbeHello {
    schema: String,
    peer_id: String,
    display_name: String,
    version: String,
}

struct NativeState {
    instance_id: String,
    display_name: Mutex<String>,
    daemon: Mutex<Option<ServiceDaemon>>,
    service_fullname: Mutex<Option<String>>,
    peers: Arc<Mutex<HashMap<String, LanPeer>>>,
    probe_stop: Mutex<Option<Arc<AtomicBool>>>,
    probe_port: Mutex<Option<u16>>,
}

impl NativeState {
    fn new() -> Self {
        Self {
            instance_id: format!("phircq-{}", Uuid::new_v4()),
            display_name: Mutex::new("Operator".to_string()),
            daemon: Mutex::new(None),
            service_fullname: Mutex::new(None),
            peers: Arc::new(Mutex::new(HashMap::new())),
            probe_stop: Mutex::new(None),
            probe_port: Mutex::new(None),
        }
    }

    fn info(&self) -> Result<NativeInfo, String> {
        let running = self
            .daemon
            .lock()
            .map_err(|_| "native daemon state lock poisoned".to_string())?
            .is_some();

        let probe_port = *self
            .probe_port
            .lock()
            .map_err(|_| "probe port state lock poisoned".to_string())?;

        Ok(NativeInfo {
            native: true,
            instance_id: self.instance_id.clone(),
            service_type: SERVICE_TYPE.to_string(),
            running,
            probe_port,
        })
    }
}

fn stop_lan_state(state: &NativeState) -> Result<(), String> {
    if let Some(stop) = state
        .probe_stop
        .lock()
        .map_err(|_| "probe stop state lock poisoned".to_string())?
        .take()
    {
        stop.store(true, Ordering::Relaxed);
    }

    *state
        .probe_port
        .lock()
        .map_err(|_| "probe port state lock poisoned".to_string())? = None;

    let daemon = state
        .daemon
        .lock()
        .map_err(|_| "native daemon state lock poisoned".to_string())?
        .take();

    if let Some(mdns) = daemon {
        let fullname = state
            .service_fullname
            .lock()
            .map_err(|_| "service name state lock poisoned".to_string())?
            .take();

        if let Some(fullname) = fullname {
            let _ = mdns.unregister(&fullname);
        }

        let _ = mdns.stop_browse(SERVICE_TYPE);
        let _ = mdns.shutdown();
    }

    state
        .peers
        .lock()
        .map_err(|_| "LAN peer state lock poisoned".to_string())?
        .clear();

    Ok(())
}

fn start_probe_server(
    peer_id: String,
    display_name: String,
) -> Result<(u16, Arc<AtomicBool>), String> {
    let listener =
        TcpListener::bind(("0.0.0.0", 0)).map_err(|error| format!("probe bind failed: {error}"))?;

    listener
        .set_nonblocking(true)
        .map_err(|error| format!("probe nonblocking setup failed: {error}"))?;

    let port = listener
        .local_addr()
        .map_err(|error| format!("probe local address failed: {error}"))?
        .port();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);

    thread::spawn(move || {
        let hello = ProbeHello {
            schema: PROBE_SCHEMA.to_string(),
            peer_id,
            display_name,
            version: env!("CARGO_PKG_VERSION").to_string(),
        };

        let payload = match serde_json::to_string(&hello) {
            Ok(value) => format!("{value}\n"),
            Err(_) => return,
        };

        while !stop_for_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                    let _ = stream.write_all(payload.as_bytes());
                    let _ = stream.flush();
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
    });

    Ok((port, stop))
}

#[tauri::command]
fn native_info(state: State<'_, NativeState>) -> Result<NativeInfo, String> {
    state.info()
}

#[tauri::command]
fn lan_start(
    display_name: String,
    state: State<'_, NativeState>,
) -> Result<NativeInfo, String> {
    stop_lan_state(&state)?;

    let trimmed_name = display_name.trim();
    let display_name = if trimmed_name.is_empty() {
        "Operator".to_string()
    } else {
        trimmed_name.to_string()
    };

    *state
        .display_name
        .lock()
        .map_err(|_| "display name state lock poisoned".to_string())? = display_name.clone();

    let (probe_port, probe_stop) =
        start_probe_server(state.instance_id.clone(), display_name.clone())?;

    let mdns =
        ServiceDaemon::new().map_err(|error| format!("mDNS daemon start failed: {error}"))?;

    let instance_suffix = state
        .instance_id
        .strip_prefix("phircq-")
        .unwrap_or(&state.instance_id);
    let short_suffix: String = instance_suffix.chars().take(8).collect();
    let instance_name = format!("PHircQ-{short_suffix}");
    let hostname = format!("{}.local.", state.instance_id);

    let properties = [
        ("peer_id", state.instance_id.as_str()),
        ("display_name", display_name.as_str()),
        ("version", env!("CARGO_PKG_VERSION")),
        ("paper_link", "1"),
        ("trust", "explicit"),
    ];

    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,
        &hostname,
        "",
        probe_port,
        &properties[..],
    )
    .map_err(|error| format!("mDNS service creation failed: {error}"))?
    .enable_addr_auto();

    let fullname = service.get_fullname().to_string();

    mdns.register(service)
        .map_err(|error| format!("mDNS registration failed: {error}"))?;

    let receiver = mdns
        .browse(SERVICE_TYPE)
        .map_err(|error| format!("mDNS browse failed: {error}"))?;

    let peers = Arc::clone(&state.peers);
    let own_peer_id = state.instance_id.clone();

    thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            match event {
                ServiceEvent::ServiceResolved(resolved) => {
                    let peer_id = match resolved.get_property_val_str("peer_id") {
                        Some(value) if !value.is_empty() => value.to_string(),
                        _ => continue,
                    };

                    if peer_id == own_peer_id {
                        continue;
                    }

                    let display_name = resolved
                        .get_property_val_str("display_name")
                        .unwrap_or("PHircQ peer")
                        .to_string();

                    let version = resolved
                        .get_property_val_str("version")
                        .unwrap_or("")
                        .to_string();

                    let mut addresses: Vec<String> = resolved
                        .get_addresses_v4()
                        .into_iter()
                        .map(|address| address.to_string())
                        .collect();
                    addresses.sort();
                    addresses.dedup();

                    let peer = LanPeer {
                        peer_id: peer_id.clone(),
                        display_name,
                        fullname: resolved.get_fullname().to_string(),
                        hostname: resolved.get_hostname().to_string(),
                        addresses,
                        port: resolved.get_port(),
                        version,
                    };

                    if let Ok(mut guard) = peers.lock() {
                        guard.insert(peer_id, peer);
                    }
                }
                ServiceEvent::ServiceRemoved(_, fullname) => {
                    if let Ok(mut guard) = peers.lock() {
                        guard.retain(|_, peer| peer.fullname != fullname);
                    }
                }
                _ => {}
            }
        }
    });

    *state
        .service_fullname
        .lock()
        .map_err(|_| "service name state lock poisoned".to_string())? = Some(fullname);

    *state
        .probe_stop
        .lock()
        .map_err(|_| "probe stop state lock poisoned".to_string())? = Some(probe_stop);

    *state
        .probe_port
        .lock()
        .map_err(|_| "probe port state lock poisoned".to_string())? = Some(probe_port);

    *state
        .daemon
        .lock()
        .map_err(|_| "native daemon state lock poisoned".to_string())? = Some(mdns);

    state.info()
}

#[tauri::command]
fn lan_stop(state: State<'_, NativeState>) -> Result<NativeInfo, String> {
    stop_lan_state(&state)?;
    state.info()
}

#[tauri::command]
fn lan_snapshot(state: State<'_, NativeState>) -> Result<Vec<LanPeer>, String> {
    let mut peers: Vec<LanPeer> = state
        .peers
        .lock()
        .map_err(|_| "LAN peer state lock poisoned".to_string())?
        .values()
        .cloned()
        .collect();

    peers.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
            .then_with(|| a.peer_id.cmp(&b.peer_id))
    });

    Ok(peers)
}

#[tauri::command]
fn lan_probe(
    peer_id: String,
    state: State<'_, NativeState>,
) -> Result<LanProbeResult, String> {
    let peer = state
        .peers
        .lock()
        .map_err(|_| "LAN peer state lock poisoned".to_string())?
        .get(&peer_id)
        .cloned()
        .ok_or_else(|| "LAN peer is no longer present.".to_string())?;

    if peer.addresses.is_empty() {
        return Ok(LanProbeResult {
            peer_id,
            address: None,
            port: peer.port,
            reachable: false,
            detail: "peer resolved without an IPv4 address".to_string(),
        });
    }

    let mut last_detail = "no address could be reached".to_string();

    for address in &peer.addresses {
        let ipv4: Ipv4Addr = match address.parse() {
            Ok(value) => value,
            Err(_) => {
                last_detail = format!("invalid IPv4 address {address}");
                continue;
            }
        };

        let socket = SocketAddr::V4(SocketAddrV4::new(ipv4, peer.port));

        match TcpStream::connect_timeout(&socket, Duration::from_millis(900)) {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(900)));
                let mut reader = BufReader::new(stream);
                let mut line = String::new();

                match reader.read_line(&mut line) {
                    Ok(0) => {
                        last_detail = format!("{address} accepted TCP but sent no PHircQ probe");
                    }
                    Ok(_) => match serde_json::from_str::<ProbeHello>(line.trim()) {
                        Ok(hello)
                            if hello.schema == PROBE_SCHEMA && hello.peer_id == peer.peer_id =>
                        {
                            return Ok(LanProbeResult {
                                peer_id: peer.peer_id,
                                address: Some(address.clone()),
                                port: peer.port,
                                reachable: true,
                                detail: format!(
                                    "verified native probe from {} / PHircQ {}",
                                    hello.display_name, hello.version
                                ),
                            });
                        }
                        Ok(_) => {
                            last_detail =
                                format!("{address} responded with a mismatched PHircQ probe");
                        }
                        Err(error) => {
                            last_detail =
                                format!("{address} returned invalid probe data: {error}");
                        }
                    },
                    Err(error) => {
                        last_detail = format!("{address} probe read failed: {error}");
                    }
                }
            }
            Err(error) => {
                last_detail = format!("{address} connect failed: {error}");
            }
        }
    }

    Ok(LanProbeResult {
        peer_id: peer.peer_id,
        address: None,
        port: peer.port,
        reachable: false,
        detail: last_detail,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NativeState::new())
        .invoke_handler(tauri::generate_handler![
            native_info,
            lan_start,
            lan_stop,
            lan_snapshot,
            lan_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running PHircQ");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_schema_is_versioned() {
        assert_eq!(PROBE_SCHEMA, "phircq.native-probe.v1");
    }

    #[test]
    fn service_type_is_local_tcp() {
        assert_eq!(SERVICE_TYPE, "_phircq._tcp.local.");
    }

    #[test]
    fn native_state_starts_stopped() {
        let state = NativeState::new();
        let info = state.info().expect("native info");
        assert!(!info.running);
        assert!(info.probe_port.is_none());
        assert!(info.instance_id.starts_with("phircq-"));
    }
}
