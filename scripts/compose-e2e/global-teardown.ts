import { rmSync } from "node:fs";
import { ADMIN_DIR } from "./fixtures";

export default function globalTeardown() {
  rmSync(ADMIN_DIR, { recursive: true, force: true });
}
