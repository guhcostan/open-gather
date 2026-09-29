import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";
import "./theme-gba.css";

createRoot(document.getElementById("root")!).render(<App />);
