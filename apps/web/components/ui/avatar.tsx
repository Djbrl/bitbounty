import { cx } from "./tone";

/** Initials backgrounds: the landing's avatar orange (a shade darker for AA) and the palette's strong tones; white text passes on all. */
const AVATAR_COLORS = ["#b35b25", "#167a45", "#2a62d6", "#7444d4", "#0e5a32", "#b13a26"];

/** Hunter tier (U3: from paid bounties). Drawn as a coloured ring around the avatar. */
export type Tier = "bronze" | "silver" | "gold";

export interface AvatarProps {
  /** Shown when there is no `src` (or as the fallback colour seed). */
  initials: string;
  /** Photo URL (GitHub avatar). */
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  /** Override the initials colour; default is derived from the initials (stable across renders). */
  color?: string;
  tier?: Tier;
  /** Accessible name (e.g. "@awa, Gold tier"). Without it the avatar is decorative (aria-hidden). */
  label?: string;
}

const SIZE = {
  sm: "size-7 text-xs",
  md: "size-10 text-[15px]",
  lg: "size-[76px] font-display text-[1.6rem] font-extrabold",
  xl: "size-32 font-display text-[2.9rem] font-extrabold",
} as const;

const RING: Record<Tier, string> = {
  bronze: "border-tier-bronze",
  silver: "border-tier-silver",
  gold: "border-tier-gold",
};

/** Round avatar: photo or initials, optional tier ring (with a transparent gap, so it sits on any surface). */
export function Avatar({ initials, src, size = "md", color, tier, label }: AvatarProps) {
  const bg = color ?? AVATAR_COLORS[[...initials].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  const face = (
    <span
      className={cx("grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white", SIZE[size])}
      style={src ? undefined : { background: bg }}
      {...(tier ? {} : a11y)}
    >
      {src ? (
        // Plain <img>: remote GitHub avatars, no next/image domain config.
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials.slice(0, 2).toUpperCase()
      )}
    </span>
  );
  if (!tier) return face;
  return (
    <span data-tier={tier} className={cx("inline-grid shrink-0 rounded-full border-2 p-0.5", RING[tier])} {...a11y}>
      {face}
    </span>
  );
}
