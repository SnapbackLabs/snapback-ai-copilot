// Copilot — GitHub workspace agent handoff target. Downloadable handoff bundle.
import { defineAiTool } from './define.js';

export default defineAiTool({
  id: 'com.focus.ai.copilot', name: 'Copilot', appKey: 'copilot', tint: 'green',
  letter: 'GH', version: '1.0.0', installs: '38k', group: 'agent',
  tagline: 'GitHub workspace agent', description: 'Open the project in VS Code with Copilot ready to pick up the tasks.',
  appName: 'Visual Studio Code', usesProject: true,
});
