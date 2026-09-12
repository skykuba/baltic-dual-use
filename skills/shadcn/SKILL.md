---
name: shadcn
description: Best practices and workflow for using, installing, and styling shadcn UI components. Use whenever adding new shadcn components, extending component styles, or creating custom variants.
---

# shadcn/ui Component Management & Styling Guidelines

This skill defines the rules and standard procedures for managing and customizing shadcn/ui components in this project.

---

## 1. Adding Components to the Library

Always install official shadcn/ui components via the shadcn CLI. Never recreate standard components from scratch or copy-paste external unofficial code.

### Command:
```bash
npx shadcn@latest add <component-name>
```

### Examples:
- Add Badge:
  ```bash
  npx shadcn@latest add badge
  ```
- Add Button, Dialog, Dropdown Menu:
  ```bash
  npx shadcn@latest add button dialog dropdown-menu
  ```

> **Note:** Run the command from the root of the project where `components.json` is located. Check `components/ui/` after installation to verify the generated component files.

---

## 2. Styling Rules: NEVER Overwrite Defaults, ALWAYS Extend

When custom styles or variations are needed for a component:

### Rule 1: Preserve Default Variants
- **DO NOT** overwrite or alter default/built-in variants (`default`, `secondary`, `destructive`, `outline`, `ghost`, etc.) in `cva(...)`.
- Keeping existing defaults intact ensures:
  - Zero regression or visual breakage across other parts of the application.
  - Predictable behavior matching official shadcn documentation.
  - Clean diffs and easy updates when re-syncing or adding components.

### Rule 2: Append Custom Variants to `cva(...)`
When a new visual design is requested, add a new variant key inside the `cva` definition:

```tsx
// File: components/ui/badge.tsx (or button.tsx, etc.)
const badgeVariants = cva(
  "group/badge inline-flex items-center justify-center ...", // base styles
  {
    variants: {
      variant: {
        // Keep existing variants untouched:
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive/10 text-destructive ...",
        outline: "border-border text-foreground ...",
        ghost: "hover:bg-muted hover:text-muted-foreground ...",

        // Add custom variants here:
        custom: "bg-custom text-custom-foreground [a]:hover:bg-custom/80",
        brand: "bg-brand text-brand-foreground hover:bg-brand/90",
        accent: "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20",
      },
    },
    defaultVariants: {
      variant: "default", // DO NOT change defaultVariants unless explicitly requested
    },
  }
)
```

### Rule 3: Context-Specific One-Off Styles
For single-instance style adjustments (e.g. margin, alignment, or minor color tweak on a specific screen), pass Tailwind classes via the `className` prop using `cn()` at the usage site, rather than creating unnecessary global variants:

```tsx
// Good for one-off layout/spacing adjustments:
<Badge variant="custom" className="shadow-sm tracking-wide">
  Custom Tag
</Badge>
```

### Rule 4: Dedicated Wrapper Components
If a component requires complex composite logic, custom state, or non-trivial JSX structure in addition to custom styles:
- Keep `components/ui/<component>.tsx` as the clean base primitive.
- Create a feature or wrapper component (e.g., `components/custom-badge.tsx` or `components/features/<feature>/<component>.tsx`) that composes the base primitive.

### Rule 5: Design Tokens & CSS Variables
When adding custom colors for new variants:
- Define custom color variables in `app/globals.css` (e.g., `--custom`, `--custom-foreground`, `--brand`).
- Add both `:root` (light) and `.dark` values.
- Do NOT alter base shadcn variables (`--primary`, `--background`, `--foreground`, etc.) unless doing a deliberate global retheme.

---

## 3. Agent Execution Checklist

Before implementing or modifying any UI component, follow these steps:

1. **Check Availability**:
   - Inspect `components/ui/` to see if the required component already exists.
2. **Install if Missing**:
   - Run `npx shadcn@latest add <component>`.
   - Verify TypeScript compilation and file generation.
3. **Customize Non-Destructively**:
   - If a new variant is needed, open `components/ui/<component>.tsx` and append the new variant under `variants: { variant: { <new-variant>: "..." } }`.
   - Never replace `default` styles.
4. **Use in Views**:
   - Import from `@/components/ui/<component>`.
   - Pass `variant="<new-variant>"`.
