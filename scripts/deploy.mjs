// Publică pe GitHub Pages: teste, build cu baza /cockpit/, apoi dist/ urcat pe ramura gh-pages.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

run("npm test");
run("npm run build", { env: { ...process.env, BASE_PATH: "/cockpit/" } });
writeFileSync("dist/.nojekyll", "");
const remote = execSync("git remote get-url origin").toString().trim();
run("git init -q -b gh-pages", { cwd: "dist" });
run("git add -A", { cwd: "dist" });
run(`git -c user.name=deploy -c user.email=deploy@users.noreply.github.com commit -q -m "Publicare ${new Date().toISOString()}"`, { cwd: "dist" });
run(`git push -f ${remote} gh-pages`, { cwd: "dist" });
console.log("Publicat: https://cojocariuemilian73.github.io/cockpit/");
