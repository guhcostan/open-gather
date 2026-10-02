import { useEffect, useState } from "react";
import { session } from "../session";
import { useStore } from "../store";

export function DebugHud() {
  const [, tick] = useState(0);
  const roster = useStore((s) => s.roster);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const st = session.view?.stats;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return (
    <pre className="debug">
      {`fps ${st?.fps ?? 0}  draws/s ${st?.renders ?? 0}  frame ${st?.frameMs ?? 0}ms\nrtt ${session.socket?.rtt ?? 0}ms  world msgs/s ${st?.worldMsgs ?? 0}\nentities ${st?.entities ?? 0} (visible ${st?.visible ?? 0})  roster ${roster.size}\n` + (mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : "")}
    </pre>
  );
}
