import { useEffect } from "react";
import { JoinScreen } from "./JoinScreen";
import { OfficeScreen } from "./OfficeScreen";
import { setState, useStore } from "../store";

export function App() {
  const phase = useStore((s) => s.phase);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((j: { authenticated?: boolean }) => setState({ phase: j.authenticated ? "play" : "join" }))
      .catch(() => setState({ phase: "join" }));
  }, []);
  if (phase === "boot") return <div className="boot" />;
  if (phase === "join") return <JoinScreen />;
  return <OfficeScreen />;
}
