// Side-effect module: import FIRST in scripts so .env.local is loaded before any module reads process.env.
import { config } from "dotenv";
config({ path: ".env.local" });
