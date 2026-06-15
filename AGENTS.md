# AGENTS.md

Guidance for coding agents working on this Illustrator CEP extension.

## Project Shape

- This is a small but sensitive Adobe Illustrator CEP extension.
- UI files live in `extension/index.html`, `extension/panel.js`, and `extension/styles.css`.
- Illustrator host logic lives in `extension/jsx/host.jsx` and is the highest-risk file.
- CEP manifest lives in `extension/CSXS/manifest.xml`.
- Dev install helper is `install-dev.ps1`.

## Current Workflow

The intended user flow is:

1. Scan a folder and pasted email.
2. Open selected source files.
3. Size selected open files.
4. Export selected files.
5. Close open source files without saving.

Important behavior:

- Do not create temp working copies for sizing.
- Open the original matched source file, or reuse it if it is already open in Illustrator.
- Resize/action/artboard changes happen only in the open Illustrator document state.
- Never save changes back to the original source file.
- Close source documents with `SaveOptions.DONOTSAVECHANGES`.
- Export must use the currently open sized document. Do not silently export a raw source file when a row was already sized and the open sized document is gone.

## Stability Rules

- Assume the project is working unless the user says otherwise.
- Keep changes narrowly scoped to the requested feature or bug.
- Preserve existing scan, matching, status, log, selection, sorting, sizing, export, report, and close behavior unless the user explicitly asks to change it.
- If a requested change affects Illustrator document lifecycle, export correctness, row status semantics, or source-file safety, think through the full workflow before editing.
- Ask the user for confirmation when behavior is ambiguous or could risk wrong exports, saved source changes, or broken existing workflow.
- Do not perform broad refactors just to clean up style.

## Host.jsx Notes

- `SIZER_HOST_STATE.rows` and `SIZER_HOST_STATE.items` are parallel arrays indexed by original row index.
- `workFsPath` currently means the path of the open source document associated with a row, not a temp copy.
- `sizerOpenSelected` opens/reuses source documents.
- `sizerSizeSelected` sizes selected rows and should require an open source document.
- `sizerExportSelected` writes PNGs and the HTML report.
- `sizerCloseOpenFiles` closes tracked open source documents without saving.
- `sizerCloseTempFiles` is kept as a compatibility alias only.
- Status values are user-visible and affect selection/filter/report behavior. Add new statuses carefully and update both `panel.js` and report/status styling where needed.

## UI Notes

- Keep the compact panel layout. This is a production tool, not a landing page.
- Buttons and labels should stay short because the panel can be narrow.
- The toolbar order should remain: selection controls, Open, Size, Export, Close.
- Do not add visible explanatory text unless the user asks; prefer status/log messages.

## Verification

- Prefer static checks that are available locally.
- `node --check extension/panel.js` is useful if Node is installed.
- `git diff --check` should pass before finishing.
- Full behavior must be verified in Illustrator because `host.jsx` depends on ExtendScript and Illustrator APIs.
- When Illustrator cannot be tested from the agent environment, say that clearly in the final response.

## File Safety

- Do not use destructive git commands unless explicitly requested.
- Do not reset or revert user changes.
- Avoid changing generated/exported output files unless the task is specifically about them.
- Keep edits ASCII unless an existing file or user-facing requirement clearly needs non-ASCII text.
