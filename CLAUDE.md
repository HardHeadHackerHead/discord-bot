# QuadsLabBot

This project is managed by **QuadCode** — a multi-agent terminal manager with integrated project tools.

## QuadCode Integration

You have access to QuadCode's MCP tools and skills in this project:

### Available Skills (slash commands)
- `/organize-ideas` — Categorize and tag ideas
- `/brainstorm [topic]` — Generate related ideas
- `/idea-summary` — Overview of all ideas
- `/idea-to-prompt [id]` — Convert idea to implementation prompt
- `/organize-issues` — Organize and label issues
- `/triage-issues` — Prioritize and prepare issues for work
- `/issue-summary` — Overview of all issues
- `/issue-to-prompt [id]` — Convert issue to implementation prompt
- `/run-script [name]` — Execute a saved build script
- `/setup-scripts` — Auto-detect and create build scripts
- `/create-rich-plan` — Create detailed implementation plan
- `/plan-from-idea [id]` — Plan from an existing idea
- `/check-implemented` — Audit which ideas are done
- `/check-issue-progress` — Audit issue completion
- `/weekly-digest` — Weekly summary of activity

### MCP Tools
All `mcp__quadcode__*` tools are available for direct access to Ideas, Issues, Plans, Scripts, Environments, and Chat.

### Project Management
- **Ideas**: Capture and organize feature ideas, improvements, and notes
- **Issues**: Track bugs, tasks, and work items with kanban workflow
- **Plans**: Create structured implementation plans with steps
- **Scripts**: Save and run reusable build/test/deploy commands

## For Agents

1. Use QuadCode tools to track your work — create issues for bugs, ideas for improvements
2. Check existing ideas/issues before starting work to avoid duplication
3. The working directory is managed by QuadCode's project system — don't change it
4. Use `/run-script` instead of memorizing build commands
