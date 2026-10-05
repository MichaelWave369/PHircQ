import {
  type FormEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { NetworkPanel } from "./components/NetworkPanel";
import { BrowserBlobStore } from "./phircq/attachments";
import { ClientRuntime } from "./phircq/runtime";
import { SqliteSnapshotStore } from "./phircq/sqliteStore";
import { LocalStorageStore } from "./phircq/store";

type SideTab = "people" | "ledger" | "agents" | "network";
type PersistenceMode = "BOOTING" | "SQLITE" | "FALLBACK";

export default function App() {
  const [runtime, setRuntime] = useState<ClientRuntime | null>(null);
  const [persistence, setPersistence] = useState<PersistenceMode>("BOOTING");
  const [, setVersion] = useState(0);
  const [input, setInput] = useState("");
  const [roomDraft, setRoomDraft] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("people");
  const [notice, setNotice] = useState("");
  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://localhost:11434");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [agentName, setAgentName] = useState("LocalAgent");
  const [agentModel, setAgentModel] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const store = await SqliteSnapshotStore.create();
        if (!active) return;

        setRuntime(
          new ClientRuntime(store, {
            blobStore: new BrowserBlobStore()
          })
        );
        setPersistence("SQLITE");
      } catch (error) {
        if (!active) return;

        setRuntime(
          new ClientRuntime(new LocalStorageStore(), {
            blobStore: new BrowserBlobStore()
          })
        );
        setPersistence("FALLBACK");
        setNotice(
          error instanceof Error
            ? `SQLite unavailable: ${error.message}`
            : "SQLite unavailable; using legacy local persistence."
        );
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (!runtime) {
    return (
      <main className="boot-screen">
        <strong>Φ PHircQ</strong>
        <span>opening local store…</span>
      </main>
    );
  }

  const activeRuntime = runtime;
  const refresh = () => setVersion((value) => value + 1);
  const state = activeRuntime.state;
  const currentRoom =
    state.rooms.find((room) => room.id === state.currentRoomId) ??
    state.rooms[0];
  const messages = state.messages.filter(
    (message) => message.roomId === currentRoom?.id
  );
  const actorById = new Map(state.actors.map((actor) => [actor.id, actor]));
  const attachmentById = new Map(
    state.attachments.map((attachment) => [attachment.id, attachment])
  );
  const self = actorById.get(state.selfId)!;
  const selectedAgent =
    state.agents.find((agent) => agent.id === selectedAgentId) ??
    state.agents[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;

    activeRuntime.submit(input);
    setInput("");
    refresh();
  }

  function addRoom(event: FormEvent) {
    event.preventDefault();
    activeRuntime.createRoom(roomDraft);
    setRoomDraft("");
    refresh();
  }

  async function attach(file: File | undefined) {
    if (!file) return;

    setNotice(`hashing ${file.name}…`);

    try {
      const meta = await activeRuntime.attachFile(file);
      setNotice(
        `stored ${meta.name} · sha256 ${meta.sha256.slice(0, 12)}…`
      );
      refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to attach file."
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadAttachment(attachmentId: string) {
    const meta = attachmentById.get(attachmentId);
    if (!meta) return;

    const blob = await activeRuntime.getAttachmentBlob(attachmentId);
    if (!blob) {
      setNotice("Attachment bytes are unavailable on this node.");
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = meta.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function scanOllama() {
    setAgentBusy(true);
    setNotice(`checking ${ollamaEndpoint}…`);

    try {
      const models = await activeRuntime.discoverOllamaModels(ollamaEndpoint);
      const names = models.map((model) => model.name);
      setOllamaModels(names);
      if (!agentModel && names[0]) setAgentModel(names[0]);
      setNotice(
        names.length
          ? `Ollama ready · ${names.length} model${names.length === 1 ? "" : "s"} found`
          : "Ollama replied, but no local models were found."
      );
    } catch (error) {
      setOllamaModels([]);
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to discover Ollama."
      );
    } finally {
      setAgentBusy(false);
    }
  }

  function createAgent() {
    try {
      const created = activeRuntime.createOllamaAgent({
        name: agentName,
        model: agentModel,
        endpoint: ollamaEndpoint,
        capabilities: ["SEND_MESSAGE"]
      });
      setSelectedAgentId(created.id);
      setSideTab("agents");
      setNotice(
        `${created.name} joined ${currentRoom?.name ?? "the current room"} as a governed agent.`
      );
      refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to create agent."
      );
    }
  }

  async function invokeAgent() {
    if (!selectedAgent) {
      setNotice("Create or select an agent first.");
      return;
    }
    if (!agentPrompt.trim()) {
      setNotice("Give the agent something to respond to.");
      return;
    }

    setAgentBusy(true);
    setNotice(`invoking ${selectedAgent.name}…`);

    try {
      await activeRuntime.invokeAgent(selectedAgent.id, agentPrompt);
      setAgentPrompt("");
      setNotice(`${selectedAgent.name} responded in ${currentRoom?.name ?? "the room"}.`);
      refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Agent invocation failed."
      );
      refresh();
    } finally {
      setAgentBusy(false);
    }
  }

  function toggleAgent(agentId: string, enabled: boolean) {
    try {
      activeRuntime.setAgentEnabled(agentId, enabled);
      refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to update agent."
      );
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <strong className="brand">Φ PHircQ</strong>
          <span className="subtitle"> local node</span>
        </div>
        <div className="status">
          <span>■ LOCAL</span>
          <span>Φ READY</span>
        </div>
      </header>

      <nav className="primary-tabs">
        <button className="active">Rooms</button>
        <button>Talk</button>
        <button onClick={() => setSideTab("agents")}>Agents</button>
        <button onClick={() => setSideTab("network")}>Net</button>
      </nav>

      <section className="workspace">
        <aside className="rooms pane">
          <div className="pane-title">ROOMS</div>

          {state.rooms
            .filter((room) => !room.archived)
            .map((room) => (
              <button
                key={room.id}
                className={
                  room.id === currentRoom?.id
                    ? "room active-room"
                    : "room"
                }
                onClick={() => {
                  activeRuntime.selectRoom(room.id);
                  refresh();
                }}
              >
                {room.name}
              </button>
            ))}

          <form className="room-create" onSubmit={addRoom}>
            <input
              value={roomDraft}
              onChange={(event) => setRoomDraft(event.target.value)}
              placeholder="#new-room"
            />
            <button>Create</button>
          </form>
        </aside>

        <section className="talk pane">
          <div className="room-header">
            <strong>{currentRoom?.name}</strong>
            <span>{currentRoom?.topic || "No topic set"}</span>
          </div>

          <div className="messages">
            {messages.map((message) => {
              const actor = actorById.get(message.actorId);
              const nick =
                message.actorId === "system"
                  ? "SYSTEM"
                  : actor?.displayName ?? message.actorId;

              return (
                <article
                  key={message.id}
                  className={`message ${message.format}`}
                >
                  <time>
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>

                  <div>
                    {message.format === "action" ? (
                      <span>
                        <b>* {nick}</b> {message.content}
                      </span>
                    ) : (
                      <span>
                        <b>&lt;{nick}&gt;</b> {message.content}
                      </span>
                    )}

                    {message.attachmentIds.map((attachmentId) => {
                      const attachment = attachmentById.get(attachmentId);
                      if (!attachment) return null;

                      return (
                        <button
                          className="file-card"
                          key={attachment.id}
                          onClick={() =>
                            void downloadAttachment(attachment.id)
                          }
                        >
                          <strong>{attachment.name}</strong>
                          <span>{attachment.size.toLocaleString()} bytes</span>
                          <code>
                            sha256:{attachment.sha256.slice(0, 16)}…
                          </code>
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <form className="composer" onSubmit={submit}>
            <span>&gt;</span>
            <input
              autoFocus
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="type message or /help"
            />

            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              onChange={(event) =>
                void attach(event.target.files?.[0])
              }
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              File
            </button>
            <button type="submit">Send</button>
          </form>

          {notice && <div className="notice">{notice}</div>}
        </section>

        <aside className="people pane">
          <div className="side-tabs four">
            <button
              className={sideTab === "people" ? "active" : ""}
              onClick={() => setSideTab("people")}
            >
              People
            </button>
            <button
              className={sideTab === "ledger" ? "active" : ""}
              onClick={() => setSideTab("ledger")}
            >
              Ledger
            </button>
            <button
              className={sideTab === "agents" ? "active" : ""}
              onClick={() => setSideTab("agents")}
            >
              Agents
            </button>
            <button
              className={sideTab === "network" ? "active" : ""}
              onClick={() => setSideTab("network")}
            >
              Net
            </button>
          </div>

          {sideTab === "people" && (
            <div>
              <div className="pane-title">IN THIS NODE</div>
              {state.actors.map((actor) => (
                <div className="person" key={actor.id}>
                  <span className="presence">
                    {actor.presence === "OFFLINE" ? "○" : "■"}
                  </span>
                  <span>{actor.displayName}</span>
                  {actor.type !== "HUMAN" && (
                    <small>[{actor.type}]</small>
                  )}
                </div>
              ))}
            </div>
          )}

          {sideTab === "ledger" && (
            <div className="ledger">
              {state.ledger
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.id}>
                    <small>{entry.result}</small> {entry.action}{" "}
                    {entry.detail ?? ""}
                  </div>
                ))}
            </div>
          )}

          {sideTab === "agents" && (
            <div className="agent-panel">
              <div className="pane-title">OLLAMA</div>
              <label>
                endpoint
                <input
                  value={ollamaEndpoint}
                  onChange={(event) => setOllamaEndpoint(event.target.value)}
                />
              </label>
              <button disabled={agentBusy} onClick={() => void scanOllama()}>
                Discover
              </button>

              <label>
                model
                <select
                  value={agentModel}
                  onChange={(event) => setAgentModel(event.target.value)}
                >
                  <option value="">select model</option>
                  {ollamaModels.map((model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                name
                <input
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                />
              </label>

              <button disabled={!agentModel} onClick={createAgent}>
                Create local agent
              </button>

              <div className="pane-title">AGENTS</div>
              {state.agents.length === 0 && (
                <p className="muted">No configured agents yet.</p>
              )}

              {state.agents.map((agent) => {
                const actor = actorById.get(agent.actorId);
                return (
                  <button
                    key={agent.id}
                    className={
                      selectedAgent?.id === agent.id
                        ? "agent-row selected"
                        : "agent-row"
                    }
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span>{agent.name}</span>
                    <small>{agent.model}</small>
                    <small>{actor?.presence ?? "OFFLINE"}</small>
                  </button>
                );
              })}

              {selectedAgent && (
                <div className="agent-console">
                  <div className="agent-meta">
                    <strong>{selectedAgent.name}</strong>
                    <code>{selectedAgent.model}</code>
                    <span>
                      caps: {selectedAgent.capabilities.join(", ") || "none"}
                    </span>
                  </div>

                  <button
                    onClick={() =>
                      toggleAgent(selectedAgent.id, !selectedAgent.enabled)
                    }
                  >
                    {selectedAgent.enabled ? "Disable" : "Enable"}
                  </button>

                  <textarea
                    rows={5}
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    placeholder="ask this agent in the current room…"
                  />
                  <button
                    disabled={agentBusy || !selectedAgent.enabled}
                    onClick={() => void invokeAgent()}
                  >
                    Invoke in {currentRoom?.name ?? "room"}
                  </button>
                </div>
              )}
            </div>
          )}


          {sideTab === "network" && (
            <NetworkPanel
              runtime={activeRuntime}
              snapshot={state}
              currentRoomName={currentRoom?.name ?? "#general"}
              localDisplayName={self.displayName}
              onRuntimeChange={refresh}
              onNotice={setNotice}
            />
          )}

        </aside>
      </section>

      <footer className="footer">
        <span>LOCAL</span>
        <span>db {persistence}</span>
        <span>peers {state.peers.length}</span>
        <span>agents {state.agents.length}</span>
        <span>files {state.attachments.length}</span>
        <span>voice PLANNED</span>
        <span>plaintext</span>
        <span className="grow" />
        <span>
          {self.displayName} / {self.presence}
        </span>
      </footer>
    </main>
  );
}
