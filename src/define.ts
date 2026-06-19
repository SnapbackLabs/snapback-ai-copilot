
import { defineHandoffIntegration, type HandoffModule, type HandoffPayload, type HandoffResult, type OptionField } from '@lockethq/snapback-sdk';
import type { Tint } from '@lockethq/snapback-sdk';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// A "project" field is shared by every tool that opens a working directory.
const PROJECT_FIELD: OptionField = {
  kind: 'text', key: 'project', label: 'Project folder', path: true,
  placeholder: '~/work/my-app',
  help: 'Absolute path to the repo/folder the tool should open.',
};

export interface AiToolConfig {
  id: string;
  name: string;
  appKey: string;
  tint: Tint;
  version: string;
  installs: string;
  description: string;
  /** Picker bucket. */
  group: 'chat' | 'agent' | 'ide';
  tagline: string;
  /** Chip letter (and whether to render it monospaced). */
  letter: string;
  mono?: boolean;
  /** macOS .app name for `open -a`, when the tool is a desktop app/IDE. */
  appName?: string;
  /** Shell command to run in a new Terminal tab, when it's a CLI agent. */
  command?: string;
  /** Extra declared fields beyond the shared project field. */
  extraFields?: OptionField[];
  /** Does this tool work in a project directory? Adds the project field. */
  usesProject?: boolean;
}

/** Compose the plaintext briefing handed to the tool — context, tasks, notes. */
function briefing(p: HandoffPayload, toolName: string): string {
  const lines = [
    `# Handoff from Snapback → ${toolName}`,
    '',
    `**Context:** ${p.context.name}`,
    p.context.apps.length ? `**Open in this context:** ${p.context.apps.map((a) => `${a.app} (${a.detail})`).join(', ')}` : '',
    '',
    '## Tasks',
    ...(p.tasks.length ? p.tasks.map((t, i) => `${i + 1}. ${t}`) : ['_(no specific tasks selected)_']),
  ];
  if (p.notes?.trim()) lines.push('', '## Notes', p.notes.trim());
  const opts = Object.entries(p.options).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && v.length === 0));
  if (opts.length) lines.push('', '## Options', ...opts.map(([k, v]) => `- **${k}:** ${Array.isArray(v) ? v.join(', ') : String(v)}`));
  return lines.filter((l) => l !== undefined).join('\n') + '\n';
}

/** `~/x` → `/Users/me/x`. Leaves absolute/other paths untouched. */
function expandHome(p: string): string {
  if (p === '~') return process.env.HOME ?? p;
  if (p.startsWith('~/')) return join(process.env.HOME ?? '', p.slice(2));
  return p;
}

async function writeBriefing(p: HandoffPayload, toolName: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'snapback-handoff-'));
  const file = join(dir, 'BRIEFING.md');
  await writeFile(file, briefing(p, toolName), 'utf8');
  return file;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function defineAiTool(cfg: AiToolConfig): HandoffModule {
  const fields: OptionField[] = [
    ...(cfg.usesProject ? [PROJECT_FIELD] : []),
    ...(cfg.extraFields ?? []),
  ];
  return defineHandoffIntegration({
    manifest: {
      id: cfg.id,
      name: cfg.name,
      version: cfg.version,
      by: 'Snapback Labs',
      category: 'AI Tools',
      description: cfg.description,
      platforms: ['darwin'],
      permissions: cfg.command ? ['process:spawn:terminal'] : [`process:spawn:${cfg.appKey}`],
      restorePriority: 3,
      appKey: cfg.appKey,
      tint: cfg.tint,
      settings: [],
    },
    handoff: {
      fields,
      group: cfg.group,
      tagline: cfg.tagline,
      chip: { letter: cfg.letter, mono: cfg.mono },
      async run(payload, ctx): Promise<HandoffResult> {
        const briefingPath = await writeBriefing(payload, cfg.name);
        const project = typeof payload.options.project === 'string' ? payload.options.project.trim() : '';
        const dir = project ? expandHome(project) : '';
        if (ctx.platform !== 'darwin') {
          return { ok: false, detail: `Briefing prepared for ${cfg.name} (launching is macOS-only for now)`, briefingPath };
        }
        try {
          if (cfg.command) {
            // CLI agent: open a Terminal tab, cd into the project, run it.
            const cd = dir ? `cd ${shellQuote(dir)} && ` : '';
            const script = `tell application "Terminal" to do script "${(cd + cfg.command).replace(/"/g, '\\"')}"`;
            await exec('osascript', ['-e', script], { timeout: ctx.timeoutMs });
            return { ok: true, detail: `Launched ${cfg.name}${dir ? ` in ${project}` : ''}`, briefingPath };
          }
          if (cfg.appName) {
            const args = ['-a', cfg.appName];
            if (dir) args.push(dir);
            await exec('open', args, { timeout: ctx.timeoutMs });
            return { ok: true, detail: `Opened ${cfg.name}${dir ? ` in ${project}` : ''}`, briefingPath };
          }
          return { ok: true, detail: `Briefing prepared for ${cfg.name}`, briefingPath };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Couldn't launch ${cfg.name}: ${msg.slice(0, 120)}`, briefingPath };
        }
      },
    },
  });
}
