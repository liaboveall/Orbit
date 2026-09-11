import dotenv from "dotenv";
dotenv.config({path:[".env.local", ".env"],quiet:true});
if (process.env.E2E_BASE_URL) throw new Error("E2E_BASE_URL reuse is disabled: use the runner-managed isolated server.");
