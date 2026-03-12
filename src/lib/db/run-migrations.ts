import { ensureDatabaseInitialized } from "./bootstrap";

ensureDatabaseInitialized();
console.log("Database migrations applied.");
