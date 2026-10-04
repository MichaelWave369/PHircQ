import { FormEvent, useRef, useState } from "react";
import { ClientRuntime } from "./phircq/runtime";
import { LocalStorageStore } from "./phircq/store";

type SideTab = "people" | "ledger";

export default function App() {
  const runtimeRef = useRef<ClientRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new ClientRuntime(new LocalStorageStore());
  }
  const runtime = runtimeRef.current;

  const [, setVersion] = useState(0);
  const [input, setInput] = useState("");
  const [roomDraft, setRoomDraft] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("people");
  const refresh = () => setVersion((value) => value + 1);

  const state = runtime.state;
  const currentRoom =
    state.rooms.find((room) => room.id === state.currentRoomId) ?? state.rooms[0];
  const messages = state.messages.filter(
    (message) => message.roomId === currentRoom?.id
  );
  const actorById = new Map(state.actors.map((actor) => [actor.id, actor]));
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
                  room.id === currentRoom?.id ? "room active-room" : "room"
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
                  {message.format === "action" ? (
                    <span>
                      <b>* {nick}</b> {message.content}
                    </span>
                  ) : (
                    <span>
                      <b>&lt;{nick}&gt;</b> {message.content}
                    </span>
                  )}
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
            <button>Send</button>
          </form>
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
                  {actor.type !== "HUMAN" && <small>[{actor.type}]</small>}
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
        <span>peers 0</span>
        <span>
          agents {state.actors.filter((actor) => actor.type === "AGENT").length}
        </span>
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
