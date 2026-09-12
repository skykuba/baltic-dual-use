@AGENTS.md

- we use shadcn UI for UI components and styling.
- always add components via: `npx shadcn@latest add <component>` (e.g. `npx shadcn@latest add badge`).
- NEVER overwrite default variants in `cva(...)`. Always append new custom variants (e.g. `variant: { custom: "..." }`) or use `className` at the call-site.
- see details in `.agents/skills/shadcn-ui/SKILL.md`.