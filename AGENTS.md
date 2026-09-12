<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# UI & Styling Guidelines (shadcn/ui)

- **Component Installation**:
  - Always add components using the CLI: `npx shadcn@latest add <component-name>` (e.g. `npx shadcn@latest add badge`).
  - Never implement standard primitives from scratch if shadcn provides them.
- **Customizing Styles (NEVER overwrite defaults)**:
  - **Preserve default variants**: Do not modify or replace base variants (`default`, `secondary`, `outline`, etc.) in `cva(...)`.
  - **Add custom variants**: When a custom look is required, append a new variant to `variants: { variant: { custom: "...", brand: "..." } }`.
  - **One-off styles**: Use `className` with `cn(...)` at the call-site for minor or page-specific adjustments.
  - **Tokens & Colors**: Put custom color definitions in `app/globals.css` under `:root` and `.dark` rather than overriding default shadcn variables.
  - Full runbook available in [.agents/skills/shadcn-ui/SKILL.md](file:///Users/Kuba/Code/baltic-dual-use/.agents/skills/shadcn-ui/SKILL.md) and [skills/shadcn/SKILL.md](file:///Users/Kuba/Code/baltic-dual-use/skills/shadcn/SKILL.md).


