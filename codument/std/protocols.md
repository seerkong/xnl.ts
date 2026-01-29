# Codument Protocols

This document defines reusable protocol blocks referenced by prompts and `<confirm>` elements in plan.xml.

## Protocol: ask-single-question-closed
**ID:** ask-single-question-closed

**Trigger:** You need to ask a single question and the answers must be chosen from fixed options (no free-text option).

**Behavior:**
- Ask one question at a time.
- Use lettered options (`A)`, `B)`, `C)`...).
- If the environment supports question ToolCalls, use those ToolCalls with equivalent content.

**Example (suggested):**
```
A) [选项 A]
B) [选项 B]
```

## Protocol: ask-single-question-free
**ID:** ask-single-question-free

**Trigger:** You need to ask a single question and allow a free-text answer in addition to suggested options.

**Behavior:**
- Ask one question at a time.
- Prefer 2-3 high-quality options when possible.
- Use lettered options (`A)`, `B)`, `C)`...).
- The **last option must allow free-text input**, but the option label/name is NOT fixed.
  - Do NOT require the literal text "自定义答案".
  - Use a flexible label such as "其他（可填写）" / "自由输入" / "自定义".
  - In ToolCall environments that already provide a built-in free-input/"Other" option, do NOT add a duplicate.
- If the environment supports question ToolCalls, use those ToolCalls with equivalent content.

**Example (suggested):**
```
A) [选项 A]
B) [选项 B]
C) [其他（可填写）]
```

## Protocol: ask-multi-question-closed
**ID:** ask-multi-question-closed

**Trigger:** You need to ask multiple questions in one round and answers must be chosen from fixed options (no free-text option).

**Behavior:**
- Ask 2-4 questions per round unless a prompt specifies a different cap.
- Prefix each question with `Q1`/`Q2`... and ask the user to answer by label.
- Use lettered options (`A)`, `B)`, `C)`...).
- Provide brief context and examples per question when helpful.
- If the environment supports question ToolCalls, use those ToolCalls with equivalent content.

**Response Format (recommended):**
```
q1: <answer>
q2: <answer>
q3: <answer>
------
q4: <answer>
```

## Protocol: ask-multi-question-free
**ID:** ask-multi-question-free

**Trigger:** You need to ask multiple questions in one round and allow free-text answers in addition to suggested options.

**Behavior:**
- Ask 2-4 questions per round unless a prompt specifies a different cap.
- Prefix each question with `Q1`/`Q2`... and ask the user to answer by label.
- Prefer 2-3 high-quality options when possible.
- Use lettered options (`A)`, `B)`, `C)`...).
- The **last option must allow free-text input**, but the option label/name is NOT fixed.
  - Do NOT require the literal text "自定义答案".
  - Use a flexible label such as "其他（可填写）" / "自由输入" / "自定义".
  - In ToolCall environments that already provide a built-in free-input/"Other" option, do NOT add a duplicate.
- Provide brief context and examples per question when helpful.
- If the environment supports question ToolCalls, use those ToolCalls with equivalent content.

**Response Format (recommended):**
```
q1: <answer>
q2: <answer>
q3: <answer>
------
q4: <answer>
```

## Protocol: yield-human-confirm
**ID:** yield-human-confirm

**Trigger:** A `<confirm protocol="yield-human-confirm" when="..." status="..." />` element exists under the current `<phase>` or `<task>` in plan.xml.

**Attributes:**
- `when` (required): `before` | `after` | `both`
- `status` (required): `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED` | `CANCELLED`

**Behavior:**
- when=before: summarize intent and scope, request confirmation before executing.
- when=after: summarize completed work, request confirmation before proceeding.
- when=both: perform both before and after confirmations.

**Status Handling:**
- Set `status=IN_PROGRESS` when starting a confirm.
- If confirmed, set `status=DONE`.
- If not confirmed or changes requested, set `status=BLOCKED`, apply changes, then re-run confirm until `status=DONE`.

**Response Handling:**
- If user confirms, proceed.
- If user requests changes, apply updates and re-confirm.
- If user declines or asks to stop, halt and await new instructions.

**Message Template (recommended):**
"Confirm (human) <phase/task> <id>: <name>. When=<before|after>. Summary: <summary>. Continue? (Y/N)"

## Protocol: yield-ai-confirm
**ID:** yield-ai-confirm

**Trigger:** A `<confirm protocol="yield-ai-confirm" when="..." ai-agent="..." status="..." />` element exists under the current `<phase>` or `<task>` in plan.xml.

**Attributes:**
- `when` (required): `before` | `after` | `both`
- `ai-agent` (required): subagent name to execute the confirmation review
- `status` (required): `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED` | `CANCELLED`

**Prompt Requirements (caller MUST include):**
- `workspace_dir`: absolute path to the workspace root
- `track_dir`: absolute path to the current track directory

**Behavior:**
1. Invoke the specified subagent (`ai-agent`) to review intent or completed work.
2. The prompt MUST pass `workspace_dir` and `track_dir`.
3. Subagent output MUST be issues-first: blocking issues, then non-blocking issues, then a brief summary.
4. Apply when logic:
   - when=before: review intent and plan before executing.
   - when=after: review completed work before proceeding.
   - when=both: perform both reviews.

**Status Handling:**
- Set `status=IN_PROGRESS` when starting a confirm.
- If no blocking issues, set `status=DONE`.
- If blocking issues are found, set `status=BLOCKED`, apply changes, then re-run confirm until `status=DONE`.

**Response Handling:**
- If blocking issues are found, stop and surface them to the user for direction.
- If only non-blocking issues (or none), proceed automatically and note risks.
- If the subagent fails or returns no result, set `status=BLOCKED` and request human confirmation.

**Message Template (recommended):**
"Confirm (ai:<ai-agent>) <phase/task> <id>: <name>. When=<before|after>. Issues-first report: <blocking> / <non-blocking>. Proceeding unless blocking issues."
