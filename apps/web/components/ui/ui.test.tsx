import { BOUNTY_STATUSES } from "@bitbounty/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatSats, formatXof } from "./amount";
import { Button } from "./button";
import { Card, StatCard } from "./card";
import { PhoneFrame } from "./phone-frame";
import { Pill } from "./pill";
import { STATUS_META } from "./status";
import { StatusPill } from "./status-pill";
import { Table, TBody, Td, Tr } from "./table";
import { TONE_PILL, TONES } from "./tone";

describe("STATUS_META", () => {
  it("covers exactly the 11 statuses of @bitbounty/core", () => {
    expect(BOUNTY_STATUSES).toHaveLength(11);
    expect(Object.keys(STATUS_META).sort()).toEqual([...BOUNTY_STATUSES].sort());
  });

  it("maps every status to a known tone and non-empty labels", () => {
    for (const s of BOUNTY_STATUSES) {
      const m = STATUS_META[s];
      expect(TONES).toContain(m.tone);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.labelFr.length).toBeGreaterThan(0);
      expect(m.hint.length).toBeGreaterThan(0);
    }
  });

  it("gives every status its own colour, in the landing's families", () => {
    const tones = Object.fromEntries(BOUNTY_STATUSES.map((s) => [s, STATUS_META[s].tone]));
    expect(new Set(Object.values(tones)).size).toBe(BOUNTY_STATUSES.length);
    expect(tones).toMatchInlineSnapshot(`
      {
        "cancelled": "outline",
        "claimed": "claim",
        "funded": "money",
        "on_hold": "pending",
        "paid": "money-solid",
        "paying": "ink",
        "payout_failed": "danger",
        "refunded": "neutral",
        "submitted": "claim-solid",
        "unfunded": "amber",
        "verified": "bright",
      }
    `);
  });

  it("has distinct labels per language", () => {
    expect(new Set(BOUNTY_STATUSES.map((s) => STATUS_META[s].label)).size).toBe(11);
    expect(new Set(BOUNTY_STATUSES.map((s) => STATUS_META[s].labelFr)).size).toBe(11);
  });
});

describe("StatusPill", () => {
  it.each(BOUNTY_STATUSES)("renders %s with its tone classes and label", (status) => {
    const meta = STATUS_META[status];
    const en = renderToStaticMarkup(<StatusPill status={status} />);
    const fr = renderToStaticMarkup(<StatusPill status={status} lang="fr" />);
    expect(en).toContain(`data-status="${status}"`);
    expect(en).toContain(`data-tone="${meta.tone}"`);
    expect(en).toContain(TONE_PILL[meta.tone]);
    expect(en).toContain(`>${meta.label}</span>`);
    expect(fr).toContain(`>${meta.labelFr}</span>`);
    expect(en).toContain(`title="${meta.hint.replaceAll("'", "&#x27;")}"`);
  });

  it("snapshot: paid", () => {
    expect(renderToStaticMarkup(<StatusPill status="paid" />)).toMatchInlineSnapshot(
      `"<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none px-2.5 py-[5px] text-xs bg-money text-on-solid" title="Paid out. Receipt available." data-status="paid" data-tone="money-solid"><i aria-hidden="true" class="inline-block size-2 shrink-0 rounded-full bg-current"></i>Paid</span>"`,
    );
  });
});

describe("base components", () => {
  it("formats FCFA and sats with grouped thousands", () => {
    expect(formatXof(62500)).toBe("62 500 F");
    expect(formatXof(1000000)).toBe("1 000 000 F");
    expect(formatXof(500)).toBe("500 F");
    expect(formatSats(120000)).toBe("120 000 sats");
  });

  it("renders Pill, Card, StatCard, Button, Table, PhoneFrame", () => {
    const html = renderToStaticMarkup(
      <div>
        <Pill tone="agent">agent</Pill>
        <Card emphasis>card</Card>
        <StatCard label="Paid" value="95 000 F" money />
        <Button disabled>Fund</Button>
        <Table>
          <TBody>
            <Tr selected>
              <Td numeric>1</Td>
            </Tr>
          </TBody>
        </Table>
        <PhoneFrame fluid>screen</PhoneFrame>
      </div>,
    );
    expect(html).toContain("bg-agent-soft text-agent");
    expect(html).toContain("border-ink");
    expect(html).toContain("text-money");
    expect(html).toContain('type="button"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("tabular-nums");
    expect(html).toContain('data-phone-frame="fluid"');
  });
});
