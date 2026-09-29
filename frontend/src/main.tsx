import { createRoot } from "react-dom/client";
import Dashboard from "./app/dashboard";
import "./app/globals.css";
const root = document.getElementById("root");
if (!root) throw new Error("页面入口不存在，请刷新重试。");
createRoot(root).render(<Dashboard />);
