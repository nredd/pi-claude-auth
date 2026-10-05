import assert from "node:assert/strict"
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import extension from "./index.ts"

const CC_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const ENV_KEYS = ["HOME", "PATH", "PI_CODING_AGENT_DIR"] as const
const FAKE_AUTH = `${JSON.stringify(
    {
        anthropic: {
            type: "oauth",
            access: "fake-access",
            refresh: "fake-refresh",
            expires: 4102444800000,
        },
    },
    null,
    2,
)}\n`

type Handler = (event: unknown, ctx: unknown) => unknown

interface Recorded {
    providers: Map<string, Record<string, unknown>>
    handlers: Map<string, Handler[]>
}

let sandbox: string
let agentDir: string
let savedEnv: Record<string, string | undefined>

function fakePi(): { pi: ExtensionAPI; recorded: Recorded } {
    const recorded: Recorded = { providers: new Map(), handlers: new Map() }
    const pi = {
        registerProvider: (id: string, config: Record<string, unknown>) => {
            recorded.providers.set(id, config)
        },
        on: (name: string, handler: Handler) => {
            recorded.handlers.set(name, [
                ...(recorded.handlers.get(name) ?? []),
                handler,
            ])
        },
    } as unknown as ExtensionAPI
    return { pi, recorded }
}

/** ctx whose auth storage fails the test on any access. */
function strictCtx(provider: string | undefined): unknown {
    const forbidden = new Proxy(
        {},
        {
            get: () => {
                throw new Error("extension touched modelRegistry/auth storage")
            },
        },
    )
    return {
        model: provider ? { provider } : undefined,
        modelRegistry: forbidden,
    }
}

function snapshotDir(dir: string): Record<string, string> {
    return Object.fromEntries(
        readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]),
    )
}

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    sandbox = mkdtempSync(join(tmpdir(), "pi-claude-auth-"))
    agentDir = join(sandbox, "agent")
    mkdirSync(agentDir)
    writeFileSync(join(agentDir, "auth.json"), FAKE_AUTH)
    // No ~/.claude, no keychain, no `claude` CLI on PATH.
    process.env.HOME = sandbox
    process.env.PATH = join(sandbox, "empty-bin")
    process.env.PI_CODING_AGENT_DIR = agentDir
})

afterEach(() => {
    for (const k of ENV_KEYS) {
        const value = savedEnv[k]
        if (value === undefined) delete process.env[k]
        else process.env[k] = value
    }
    rmSync(sandbox, { recursive: true, force: true })
})

async function load(): Promise<Recorded> {
    const { pi, recorded } = fakePi()
    await extension(pi)
    return recorded
}

function hookOf(recorded: Recorded): Handler {
    const hooks = recorded.handlers.get("before_provider_request") ?? []
    assert.equal(hooks.length, 1)
    return hooks[0]
}

function oauthPayload(): Record<string, unknown> {
    return {
        model: "claude-sonnet-4-5",
        system: [{ type: "text", text: CC_IDENTITY }],
        messages: [{ role: "user", content: "hi" }],
    }
}

test("registers header override and request hook without a Claude store", async () => {
    const before = snapshotDir(agentDir)
    const recorded = await load()

    const provider = recorded.providers.get("anthropic")
    assert.ok(provider, "anthropic provider override registered")
    assert.deepEqual(Object.keys(provider), ["headers"])
    assert.match(
        (provider.headers as Record<string, string>)["user-agent"],
        /^claude-cli\//,
    )
    assert.deepEqual([...recorded.handlers.keys()], ["before_provider_request"])

    // Pi's auth.json is byte-identical and nothing new was written.
    assert.equal(readFileSync(join(agentDir, "auth.json"), "utf8"), FAKE_AUTH)
    assert.deepEqual(snapshotDir(agentDir), before)
    assert.deepEqual(readdirSync(sandbox), ["agent"])
})

test("missing Pi credentials do not prevent extension registration", async () => {
    rmSync(join(agentDir, "auth.json"))
    const recorded = await load()
    assert.ok(recorded.providers.has("anthropic"))
    assert.equal(recorded.handlers.size, 1)
    assert.deepEqual(readdirSync(agentDir), [])
})

test("repeated startup is idempotent and writes nothing", async () => {
    const before = snapshotDir(agentDir)
    const first = await load()
    const second = await load()

    assert.deepEqual(first.providers, second.providers)
    assert.equal(hookOf(first).length, hookOf(second).length)
    assert.deepEqual(snapshotDir(agentDir), before)
    assert.deepEqual(readdirSync(sandbox), ["agent"])
})

test("hook injects the billing entry for anthropic OAuth payloads", async () => {
    const hook = hookOf(await load())
    const out = hook({ payload: oauthPayload() }, strictCtx("anthropic")) as {
        system: unknown[]
    }
    assert.equal(out.system.length, 2)
    assert.equal(readFileSync(join(agentDir, "auth.json"), "utf8"), FAKE_AUTH)
})

test("hook leaves API-key payloads untouched (no identity block)", async () => {
    const hook = hookOf(await load())
    const payload = {
        model: "claude-sonnet-4-5",
        system: [{ type: "text", text: "You are a helpful assistant." }],
        messages: [{ role: "user", content: "hi" }],
    }
    const copy = structuredClone(payload)
    assert.equal(hook({ payload }, strictCtx("anthropic")), undefined)
    assert.deepEqual(payload, copy)
})

test("hook leaves enterprise Claude payloads untouched", async () => {
    const hook = hookOf(await load())
    const payload = {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        system: "Enterprise system prompt",
        messages: [{ role: "user", content: "hi" }],
    }
    const copy = structuredClone(payload)
    assert.equal(hook({ payload }, strictCtx("amazon-bedrock")), undefined)
    assert.deepEqual(payload, copy)
})

test("hook formats routed OAuth requests once and ignores routed API-key requests", async () => {
    const hook = hookOf(await load())
    const ctx = { model: { provider: "router", api: "pi-virtual" } }
    const payload = oauthPayload()
    assert.ok(hook({ payload }, ctx))
    const formatted = structuredClone(payload)
    assert.equal(hook({ payload }, ctx), undefined)
    assert.deepEqual(payload, formatted)
    const apiKeyPayload = { ...oauthPayload(), system: [] }
    const original = structuredClone(apiKeyPayload)
    assert.equal(hook({ payload: apiKeyPayload }, ctx), undefined)
    assert.deepEqual(apiKeyPayload, original)
})

test("hook ignores non-anthropic providers and missing model", async () => {
    const hook = hookOf(await load())
    for (const provider of ["openai", "enterprise", undefined]) {
        const payload = oauthPayload()
        const copy = structuredClone(payload)
        assert.equal(hook({ payload }, strictCtx(provider)), undefined)
        assert.deepEqual(payload, copy)
    }
})
