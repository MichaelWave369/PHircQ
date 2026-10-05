import {
  type FormEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { BrowserBlobStore } from "./phircq/attachments";
import { ClientRuntime } from "./phircq/runtime";
import { SqliteSnapshotStore } from "./phircq/sqliteStore";
import { LocalStorageStore } from "./phircq/store";

type SideTab = "people" | "ledger";
type PersistenceMode = "BOOTING" | "SQLITE" | "FALLBACK";

export default function App() {
  const [runtime, setRuntime] = useState<ClientRuntime | null>(null);
  const [persistence, setPersistence] = useState<PersistenceMode>("BOOTING");
  const [, setVersion] = useState(0);
  const [input, setInput] = useState("");
  const [roomDraft, setRoomDraft] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("people");
  const [notice, setNotice] = useState("");
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

  const refresh = () => setVersion((value) => value + 1);
  const state = runtime.state;
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;

    runtime.submit(input);
    setInput("");
    refresh();
  }

  function addRoom(event: FormEvent) {
    event.preventDefault();
    runtime.createRoom(roomDraft);
    setRoomDraft("");
    refresh();
  }

  async function attach(file: File | undefined) {
    if (!file) return;

    setNotice(`hashing ${file.name}…`);

    try {
      const meta = await runtime.attachFile(file);
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

    const blob = await runtime.getAttachmentBlob(attachmentId);
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
        <button>People</button>
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
                  runtime.selectRoom(room.id);
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
          <div className="side-tabs">
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
          </div>

          {sideTab === "people" ? (
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
          ) : (
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
        </aside>
      </section>

      <footer className="footer">
        <span>LOCAL</span>
        <span>db {persistence}</span>
        <span>peers 0</span>
        <span>
          agents{" "}
          {state.actors.filter((actor) => actor.type === "AGENT").length}
        </span>
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
