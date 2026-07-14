import Phaser from 'phaser';

import { ATLAS_KEY, DESIGN_WIDTH, PANEL_SLICE } from '../config';
import type { CropId } from '../data/crops';
import { CROPS } from '../data/crops';
import {
  LONG_QUESTS,
  type LongQuestDef,
  QUEST_BOARD_INTRO,
  type QuestReward,
  WEEKLY_QUESTS,
  type WeeklyQuestDef,
  WEEK_MS,
} from '../data/quests';
import type { AudioManager } from '../systems/audio';
import { gameState, type GameStateData, type QuestProgress } from '../systems/gameState';
import { setPanelOpen } from '../systems/modalPanels';
import type { Hud } from './Hud';
import { ModalBackdrop } from './ModalBackdrop';

/**
 * Modal Quest Board (T3.10a), opened by the HUD's scroll icon: a "This Week"
 * section with the 2 currently-active weekly quests (live progress + a
 * reset countdown) above a compact "Long-Term Quests" list of all 7
 * `LONG_QUESTS`. Renders purely from the `GameStateData` passed to `refresh`
 * plus `gameState.questProgress`/`claimQuest` - this panel owns no quest
 * state itself, mirroring `DecorShop`'s relationship to `gameState`.
 *
 * Claim juice per reward type: chests ride the existing chest-ceremony queue
 * (already drained on `FarmScene`'s tick - claiming needs no extra wiring
 * here), moondust flies to the HUD counter via the `hud` dependency (mirrors
 * `ChestCeremony`'s own use of `Hud`'s public fly methods), and a trophy
 * flashes "In your Warehouse!" briefly on its row.
 */

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 1320;
const PANEL_CENTER_X = DESIGN_WIDTH / 2;
const PANEL_CENTER_Y = 960;
/** Same layer as the other modal panels (2100) - the HUD never shows more than one at once. */
const PANEL_DEPTH = 2100;

const TITLE_Y = -PANEL_HEIGHT / 2 + 60;
const CLOSE_OFFSET_X = PANEL_WIDTH / 2 - 50;
const CLOSE_OFFSET_Y = -PANEL_HEIGHT / 2 + 50;
/** Onboarding-style close-control hit padding is not needed here - the
 * board is fully tutorial-inert (see `railsAllow('quest-board')`), so no
 * pulse target is ever registered against it. */

/**
 * WEEKLY section: header row ("This Week" + reset countdown) then 2 cards,
 * one per `weekly.activeIds` entry, stacked vertically.
 */
const WEEKLY_HEADER_Y = -545;
const WEEKLY_CARD_WIDTH = 820;
const WEEKLY_CARD_HEIGHT = 130;
const WEEKLY_CARD_START_Y = -440;
const WEEKLY_CARD_SPACING = 150;

const WEEKLY_NAME_X = -WEEKLY_CARD_WIDTH / 2 + 30;
/** Nudged down slightly (was -32) per live review - reads better closer to the progress line. */
const WEEKLY_NAME_Y_OFFSET = -24;
const WEEKLY_PROGRESS_X = WEEKLY_NAME_X;
/**
 * T3.10b: raised the progress font back to 26px (see CARD_PROGRESS_STYLE)
 * instead of shrinking it to fit under the reward-icon row, so this moved
 * down from its old y=20 to y=42 to clear the icons (WEEKLY_ICON_SIZE 44,
 * bottom edge at +22) - at 42, the pool's longest line
 * ("Minutes of growth harvested: 400/400 min") clears the CLAIM BUTTON's
 * left edge instead (a much bigger ~645px budget - see CARD_PROGRESS_STYLE).
 * Pulled back up to 26 per live review (title/subtext read too far apart at
 * 42) - NOTE this reopens a few px of vertical overlap with the reward
 * icons' bottom edge for that one longest line specifically; every other
 * pool member's line is short enough to clear the icon horizontally well
 * before reaching it, so this is a narrow, accepted tradeoff, not a general
 * regression.
 */
const WEEKLY_PROGRESS_Y_OFFSET = 26;

const WEEKLY_ICON_SIZE = 44;
/** Fixed columns (mirrors OrderBoard's reward row): chest/trophy slot, then
 * moondust - only weekly_specialist ever shows both at once. */
const WEEKLY_REWARD_PRIMARY_X = 60;
const WEEKLY_REWARD_MOONDUST_X = 150;

const WEEKLY_CLAIM_X = 330;
const WEEKLY_CLAIM_WIDTH = 130;
const WEEKLY_CLAIM_HEIGHT = 80;

/**
 * LONG section: header below the 2 weekly cards (card 2's bottom edge sits
 * at WEEKLY_CARD_START_Y + WEEKLY_CARD_SPACING + WEEKLY_CARD_HEIGHT / 2 =
 * -225), then 7 compact rows, no per-row background (matches `DecorShop`'s
 * plain-on-panel row style). MEASURED to fit: at a 90px nominal row height
 * (half 45), the 7th row's bottom edge (LONG_ROW_START_Y + 6 *
 * LONG_ROW_SPACING + 45 = 559) clears the panel's own bottom edge
 * (PANEL_HEIGHT / 2 = 660) by ~100px.
 */
const LONG_HEADER_Y = -175;
const LONG_ROW_START_Y = -110;
const LONG_ROW_SPACING = 100;

const LONG_ICON_X = -PANEL_WIDTH / 2 + 80;
const LONG_ICON_SIZE = 64;
const LONG_NAME_X = -300;
const LONG_NAME_Y_OFFSET = -18;
const LONG_PROGRESS_X = -300;
const LONG_PROGRESS_Y_OFFSET = 18;
/** Never actually shown today (no LONG_QUESTS def combines a trophy/chest
 * reward with moondust), but composable per `QuestReward` - placed clear of
 * both the icon/name column and the claim button for when it is. */
const LONG_REWARD_MOONDUST_X = 150;

const LONG_CLAIM_X = 340;
const LONG_CLAIM_WIDTH = 150;
const LONG_CLAIM_HEIGHT = 70;

/** "x2"/"x3" chest-count badge, perched on the chest icon's bottom-right corner. */
const CHEST_BADGE_OFFSET = 20;

const CLAIM_ENABLED_ALPHA = 1;
const CLAIM_CLAIMED_ALPHA = 0.6;

/** The "In your Warehouse!" flash: quick scale-in, brief hold, fade - mirrors OrderBoard's "Done!" stamp. */
const FLASH_IN_MS = 150;
const FLASH_HOLD_MS = 500;
const FLASH_FADE_MS = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * First-open explainer (T3.14): a centered read-and-confirm card over the
 * board, dimming it out - swallows every tap within the board's own bounds
 * so nothing underneath (close X, claim buttons) is reachable until "Got
 * it" is tapped. Sits just above PANEL_DEPTH so it always draws over the
 * board's own content.
 */
const INTRO_DEPTH = PANEL_DEPTH + 10;
const INTRO_DIM_ALPHA = 0.6;
const INTRO_CARD_WIDTH = 760;
const INTRO_CARD_HEIGHT = 520;
const INTRO_TITLE_Y = -INTRO_CARD_HEIGHT / 2 + 80;
const INTRO_BODY_Y = -20;
const INTRO_BODY_WIDTH = INTRO_CARD_WIDTH - 100;
const INTRO_BUTTON_Y = INTRO_CARD_HEIGHT / 2 - 80;
const INTRO_BUTTON_WIDTH = 260;
const INTRO_BUTTON_HEIGHT = 90;

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '48px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CLOSE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '40px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const SECTION_HEADER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '34px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const COUNTDOWN_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'italic',
  color: '#7a5518',
};

const CARD_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '32px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * 26px, unchanged from before T3.10b's labels (see WEEKLY_PROGRESS_Y_OFFSET
 * for why moving the line down, not shrinking it, was the fix). MEASURED via
 * canvas measureText at 'Arial, sans-serif': the pool's longest progress
 * line, weekly_growth's "Minutes of growth harvested: 400/400 min" (worst
 * case at 3-digit current/target), is 484.16px against the ~645px budget
 * from WEEKLY_PROGRESS_X to the claim button's left edge - clears it by
 * ~161px. The style is shared across both card slots (either can show any
 * pool member), so it must fit the worst case, not just its own def.
 */
const CARD_PROGRESS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  color: '#7a5518',
};

const ROW_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/**
 * 24px, unchanged (T3.10b: MEASURED the longest long-quest line, "Premium
 * orders fulfilled: 25/25", at 325.48px against a ~565px budget from
 * LONG_PROGRESS_X to the claim button's left edge - comfortable margin, no
 * shrink needed).
 */
const ROW_PROGRESS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  color: '#7a5518',
};

const CHEST_BADGE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '22px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const MOONDUST_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const CLAIM_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  fontStyle: 'bold',
  color: '#4a3218',
};

/** Dimmer/smaller than CLAIM_BUTTON_STYLE - reads as inert, not actionable. */
const CLAIMED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '24px',
  color: '#7a5518',
};

const INTRO_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '42px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const INTRO_BODY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '28px',
  color: '#4a3218',
  align: 'center',
  wordWrap: { width: INTRO_BODY_WIDTH },
};

const INTRO_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#4a3218',
};

const FLASH_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Georgia, serif',
  fontSize: '26px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 5,
};

/** Real-clock days/hours-floored countdown - "resets in 3d 4h". */
function formatCountdown(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const days = Math.floor(clamped / DAY_MS);
  const hours = Math.floor((clamped % DAY_MS) / HOUR_MS);
  return `resets in ${days}d ${hours}h`;
}

/** One reward's icon set: a primary slot (trophy XOR chest, mutually
 * exclusive per `QuestReward`) plus a moondust slot - both may show at once
 * (weekly_specialist composes chests + moondust). */
interface QuestRewardIcons {
  primaryIcon: Phaser.GameObjects.Image;
  primaryBadge: Phaser.GameObjects.Text;
  moondustIcon: Phaser.GameObjects.Image;
  moondustText: Phaser.GameObjects.Text;
}

interface WeeklyCard {
  nameText: Phaser.GameObjects.Text;
  progressText: Phaser.GameObjects.Text;
  rewardIcons: QuestRewardIcons;
  claimButton: Phaser.GameObjects.NineSlice;
  claimText: Phaser.GameObjects.Text;
  worldX: number;
  worldY: number;
  /** The WEEKLY_QUESTS id this card currently represents - re-derived every
   * refresh from `weekly.activeIds`; the claim tap handler reads this. */
  currentId: string | null;
}

interface LongRow {
  def: LongQuestDef;
  progressText: Phaser.GameObjects.Text;
  claimButton: Phaser.GameObjects.NineSlice;
  claimText: Phaser.GameObjects.Text;
  flashText: Phaser.GameObjects.Text;
  worldX: number;
  worldY: number;
}

export class QuestBoard {
  private readonly container: Phaser.GameObjects.Container;
  private readonly backdrop: ModalBackdrop;
  private readonly countdownText: Phaser.GameObjects.Text;
  private readonly weeklyCards: WeeklyCard[] = [];
  private readonly longRows: LongRow[] = [];
  private readonly introContainer: Phaser.GameObjects.Container;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hud: Hud,
    private readonly audio: AudioManager,
  ) {
    this.backdrop = new ModalBackdrop(scene, () => {
      this.audio.sfx('tap');
      this.hide();
    });
    this.container = scene.add
      .container(PANEL_CENTER_X, PANEL_CENTER_Y)
      .setDepth(PANEL_DEPTH)
      .setVisible(false);

    const bg = scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      PANEL_WIDTH,
      PANEL_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    // Swallow taps on the panel body so they never fall through to the field beneath.
    bg.setInteractive();
    bg.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );
    const title = scene.add.text(0, TITLE_Y, 'Quests', TITLE_STYLE).setOrigin(0.5);
    const closeButton = scene.add
      .text(CLOSE_OFFSET_X, CLOSE_OFFSET_Y, 'X', CLOSE_STYLE)
      .setOrigin(0.5)
      .setPadding(16)
      .setInteractive({ useHandCursor: true });
    closeButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('tap');
      this.hide();
    });

    const weeklyHeader = scene.add
      .text(-PANEL_WIDTH / 2 + 40, WEEKLY_HEADER_Y, 'This Week', SECTION_HEADER_STYLE)
      .setOrigin(0, 0.5);
    this.countdownText = scene.add
      .text(PANEL_WIDTH / 2 - 40, WEEKLY_HEADER_Y, '', COUNTDOWN_STYLE)
      .setOrigin(1, 0.5);

    const longHeader = scene.add
      .text(-PANEL_WIDTH / 2 + 40, LONG_HEADER_Y, 'Long-Term Quests', SECTION_HEADER_STYLE)
      .setOrigin(0, 0.5);

    this.container.add([bg, title, closeButton, weeklyHeader, this.countdownText, longHeader]);

    for (let i = 0; i < 2; i++) {
      this.weeklyCards.push(this.buildWeeklyCard(WEEKLY_CARD_START_Y + i * WEEKLY_CARD_SPACING));
    }
    LONG_QUESTS.forEach((def, index) => {
      this.longRows.push(this.buildLongRow(def, LONG_ROW_START_Y + index * LONG_ROW_SPACING));
    });

    this.introContainer = this.buildIntro();
  }

  private buildIntro(): Phaser.GameObjects.Container {
    const container = this.scene.add
      .container(PANEL_CENTER_X, PANEL_CENTER_Y)
      .setDepth(INTRO_DEPTH)
      .setVisible(false);

    const dim = this.scene.add
      .rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 0x000000, INTRO_DIM_ALPHA)
      .setOrigin(0.5);
    // Swallows every tap within the board's bounds - nothing beneath (close
    // X, claim buttons) is reachable while the explainer is up.
    dim.setInteractive();
    dim.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );

    const card = this.scene.add.nineslice(
      0,
      0,
      ATLAS_KEY,
      'panel',
      INTRO_CARD_WIDTH,
      INTRO_CARD_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const title = this.scene.add
      .text(0, INTRO_TITLE_Y, QUEST_BOARD_INTRO.title, INTRO_TITLE_STYLE)
      .setOrigin(0.5);
    const body = this.scene.add
      .text(0, INTRO_BODY_Y, QUEST_BOARD_INTRO.body, INTRO_BODY_STYLE)
      .setOrigin(0.5);

    const button = this.scene.add
      .nineslice(
        0,
        INTRO_BUTTON_Y,
        ATLAS_KEY,
        'panel',
        INTRO_BUTTON_WIDTH,
        INTRO_BUTTON_HEIGHT,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
        PANEL_SLICE,
      )
      .setInteractive({ useHandCursor: true });
    const buttonText = this.scene.add
      .text(0, INTRO_BUTTON_Y, QUEST_BOARD_INTRO.buttonLabel, INTRO_BUTTON_STYLE)
      .setOrigin(0.5);
    // Dismiss only via this button - the dim layer above swallows every
    // other tap, and gameState.markQuestsIntroSeen persists the dismissal
    // so it never shows again.
    button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.audio.sfx('confirm');
      gameState.markQuestsIntroSeen();
      container.setVisible(false);
    });

    container.add([dim, card, title, body, button, buttonText]);
    return container;
  }

  private buildRewardIcons(primaryX: number, moondustX: number, y: number): QuestRewardIcons {
    const primaryIcon = this.scene.add
      .image(primaryX, y, ATLAS_KEY, 'chest_closed')
      .setVisible(false);
    const primaryBadge = this.scene.add
      .text(primaryX + CHEST_BADGE_OFFSET, y + CHEST_BADGE_OFFSET, '', CHEST_BADGE_STYLE)
      .setOrigin(0.5)
      .setVisible(false);
    const moondustIcon = this.scene.add
      .image(moondustX, y, ATLAS_KEY, 'moondust')
      .setVisible(false);
    const moondustText = this.scene.add
      .text(moondustX + 30, y, '', MOONDUST_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.container.add([primaryIcon, primaryBadge, moondustIcon, moondustText]);
    return { primaryIcon, primaryBadge, moondustIcon, moondustText };
  }

  /** Trophy XOR chest (a `QuestReward` never carries both) - re-set every refresh
   * since a weekly card's underlying def can rotate; a long row's reward is
   * config-fixed, so its caller only needs to call this once. */
  private applyPrimaryIcon(icons: QuestRewardIcons, reward: QuestReward, size: number): void {
    if (reward.trophy !== undefined) {
      icons.primaryIcon.setFrame(reward.trophy).setDisplaySize(size, size).setVisible(true);
      icons.primaryBadge.setVisible(false);
    } else if (reward.chests !== undefined && reward.chests > 0) {
      icons.primaryIcon.setFrame('chest_closed').setDisplaySize(size, size).setVisible(true);
      icons.primaryBadge.setText(`x${reward.chests}`).setVisible(reward.chests > 1);
    } else {
      icons.primaryIcon.setVisible(false);
      icons.primaryBadge.setVisible(false);
    }
  }

  private applyMoondustIcon(icons: QuestRewardIcons, reward: QuestReward, size: number): void {
    if (reward.moondust !== undefined && reward.moondust > 0) {
      icons.moondustIcon.setDisplaySize(size, size).setVisible(true);
      icons.moondustText.setText(String(reward.moondust)).setVisible(true);
    } else {
      icons.moondustIcon.setVisible(false);
      icons.moondustText.setVisible(false);
    }
  }

  private buildWeeklyCard(y: number): WeeklyCard {
    const cardBg = this.scene.add.nineslice(
      0,
      y,
      ATLAS_KEY,
      'panel',
      WEEKLY_CARD_WIDTH,
      WEEKLY_CARD_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const nameText = this.scene.add
      .text(WEEKLY_NAME_X, y + WEEKLY_NAME_Y_OFFSET, '', CARD_NAME_STYLE)
      .setOrigin(0, 0.5);
    const progressText = this.scene.add
      .text(WEEKLY_PROGRESS_X, y + WEEKLY_PROGRESS_Y_OFFSET, '', CARD_PROGRESS_STYLE)
      .setOrigin(0, 0.5);
    const rewardIcons = this.buildRewardIcons(WEEKLY_REWARD_PRIMARY_X, WEEKLY_REWARD_MOONDUST_X, y);
    for (const icon of [rewardIcons.primaryIcon, rewardIcons.moondustIcon]) {
      icon.setDisplaySize(WEEKLY_ICON_SIZE, WEEKLY_ICON_SIZE);
    }

    const claimButton = this.scene.add.nineslice(
      WEEKLY_CLAIM_X,
      y,
      ATLAS_KEY,
      'panel',
      WEEKLY_CLAIM_WIDTH,
      WEEKLY_CLAIM_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const claimText = this.scene.add.text(WEEKLY_CLAIM_X, y, '', CLAIM_BUTTON_STYLE).setOrigin(0.5);

    const card: WeeklyCard = {
      nameText,
      progressText,
      rewardIcons,
      claimButton,
      claimText,
      worldX: PANEL_CENTER_X + WEEKLY_CLAIM_X,
      worldY: PANEL_CENTER_Y + y,
      currentId: null,
    };
    claimButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (card.currentId === null) return;
      this.claim(card.currentId, card.worldX, card.worldY);
    });

    this.container.add([cardBg, nameText, progressText, claimButton, claimText]);
    return card;
  }

  private buildLongRow(def: LongQuestDef, y: number): LongRow {
    const icon = this.scene.add
      .image(LONG_ICON_X, y, ATLAS_KEY, 'chest_closed')
      .setDisplaySize(LONG_ICON_SIZE, LONG_ICON_SIZE);
    const nameText = this.scene.add
      .text(LONG_NAME_X, y + LONG_NAME_Y_OFFSET, def.name, ROW_NAME_STYLE)
      .setOrigin(0, 0.5);
    const progressText = this.scene.add
      .text(LONG_PROGRESS_X, y + LONG_PROGRESS_Y_OFFSET, '', ROW_PROGRESS_STYLE)
      .setOrigin(0, 0.5);
    // The reward is config-fixed for a long quest (never rotates), so its
    // icon is set once here rather than every refresh.
    const rewardIcons: QuestRewardIcons = {
      primaryIcon: icon,
      primaryBadge: this.scene.add
        .text(LONG_ICON_X + CHEST_BADGE_OFFSET, y + CHEST_BADGE_OFFSET, '', CHEST_BADGE_STYLE)
        .setOrigin(0.5)
        .setVisible(false),
      moondustIcon: this.scene.add
        .image(LONG_REWARD_MOONDUST_X, y, ATLAS_KEY, 'moondust')
        .setDisplaySize(LONG_ICON_SIZE * 0.7, LONG_ICON_SIZE * 0.7)
        .setVisible(false),
      moondustText: this.scene.add
        .text(LONG_REWARD_MOONDUST_X + 30, y, '', MOONDUST_TEXT_STYLE)
        .setOrigin(0, 0.5)
        .setVisible(false),
    };
    this.applyPrimaryIcon(rewardIcons, def.reward, LONG_ICON_SIZE);
    this.applyMoondustIcon(rewardIcons, def.reward, LONG_ICON_SIZE * 0.7);

    const claimButton = this.scene.add.nineslice(
      LONG_CLAIM_X,
      y,
      ATLAS_KEY,
      'panel',
      LONG_CLAIM_WIDTH,
      LONG_CLAIM_HEIGHT,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
      PANEL_SLICE,
    );
    const claimText = this.scene.add.text(LONG_CLAIM_X, y, '', CLAIM_BUTTON_STYLE).setOrigin(0.5);

    // Row-centered (not LONG_NAME_X) so it never overlaps the name/progress
    // text it briefly covers - live-verified (T3.10a) the name-aligned
    // version visibly collided with "500/500" on claim.
    const flashText = this.scene.add
      .text(0, y, 'In your Warehouse!', FLASH_STYLE)
      .setOrigin(0.5)
      .setVisible(false);

    const row: LongRow = {
      def,
      progressText,
      claimButton,
      claimText,
      flashText,
      worldX: PANEL_CENTER_X + LONG_CLAIM_X,
      worldY: PANEL_CENTER_Y + y,
    };
    claimButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      this.claim(def.id, row.worldX, row.worldY);
    });

    this.container.add([
      icon,
      rewardIcons.primaryBadge,
      rewardIcons.moondustIcon,
      rewardIcons.moondustText,
      nameText,
      progressText,
      claimButton,
      claimText,
      flashText,
    ]);
    return row;
  }

  /**
   * "growth" reads as elapsed grow-minutes (its label + "n/N min"),
   * "specialist" names this week's featured crop instead of its
   * `progressLabel` (T3.10a spec: "featured crop's name substituted into the
   * specialist's copy" - already names what it counts), everything else is
   * `${progressLabel}: n/N` (T3.10b - a bare "n/N" didn't say what was being
   * counted).
   */
  private formatWeeklyProgress(
    def: WeeklyQuestDef,
    progress: QuestProgress,
    featuredCrop: CropId,
  ): string {
    const current = Math.floor(progress.current);
    const target = Math.floor(progress.target);
    if (def.id === 'weekly_growth') return `${def.progressLabel}: ${current}/${target} min`;
    if (def.id === 'weekly_specialist') return `${CROPS[featuredCrop].name}: ${current}/${target}`;
    return `${def.progressLabel}: ${current}/${target}`;
  }

  /**
   * A row's Claim button is hidden entirely (T3.14) until the quest is
   * actually claimable - the existing progress label already communicates
   * "not there yet", so a permanently-disabled "Claim" a player could tap
   * for nothing is just confusing (playtest finding). Once claimed, the
   * button stays visible as a dimmed "✓ Claimed" confirmation.
   */
  private setClaimState(
    button: Phaser.GameObjects.NineSlice,
    text: Phaser.GameObjects.Text,
    progress: QuestProgress,
  ): void {
    if (progress.claimed) {
      button.setVisible(true);
      text.setVisible(true).setText('✓ Claimed').setStyle(CLAIMED_STYLE);
      button.setAlpha(CLAIM_CLAIMED_ALPHA);
      button.disableInteractive();
      return;
    }
    if (!progress.complete) {
      button.setVisible(false);
      text.setVisible(false);
      button.disableInteractive();
      return;
    }
    button.setVisible(true);
    text.setVisible(true).setText('Claim').setStyle(CLAIM_BUTTON_STYLE);
    button.setAlpha(CLAIM_ENABLED_ALPHA);
    button.setInteractive({ useHandCursor: true });
  }

  /**
   * Claim `id`'s reward (only fires from a button the store would actually
   * accept - see `setClaimState`, so this call always succeeds in practice,
   * but still checks the return in case of a same-tick race). The store
   * grants everything instantly with no visuals of its own: chests queue a
   * `ChestEvent` `FarmScene`'s own tick already drains (no wiring needed
   * here), moondust needs an explicit fly to the HUD counter, and a trophy
   * needs its row's flash - both driven from the quest's own config `def`,
   * looked up once here rather than threaded through every caller.
   */
  private claim(id: string, worldX: number, worldY: number): void {
    const def: LongQuestDef | WeeklyQuestDef | undefined =
      LONG_QUESTS.find((quest) => quest.id === id) ??
      WEEKLY_QUESTS.find((quest) => quest.id === id);
    if (def === undefined) return;
    const moondustBefore = gameState.getState().moondust;
    if (!gameState.claimQuest(id)) return;
    // A chest reward's own coin/moondust roll is granted to state instantly
    // but not revealed until the ceremony's dismiss beat (possibly many
    // ticks away, e.g. deferred behind a level-up) - hold both HUD counters
    // so the periodic refresh doesn't drift ahead of that reveal, exactly
    // mirroring Hud.fulfillOrder's own `order.premium?.chests` hold (see its
    // comment). The quest's OWN moondust reward (below) still flies
    // immediately, same as an order's own moondust never being held either.
    if (def.reward.chests !== undefined && def.reward.chests > 0) {
      this.hud.holdCoinDisplay();
      this.hud.holdMoondustDisplay();
    }
    this.audio.sfx('confirm');
    if (def.reward.moondust !== undefined && def.reward.moondust > 0) {
      this.hud.flyQuestReward(worldX, worldY, moondustBefore, def.reward.moondust);
    }
    if (def.reward.trophy !== undefined) {
      this.flashTrophy(id);
    }
    this.refresh(gameState.getState());
  }

  private flashTrophy(id: string): void {
    const row = this.longRows.find((candidate) => candidate.def.id === id);
    if (row === undefined) return;
    const flash = row.flashText;
    this.scene.tweens.killTweensOf(flash);
    flash.setVisible(true).setAlpha(1).setScale(0);
    this.scene.tweens.add({
      targets: flash,
      scale: 1,
      duration: FLASH_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: flash,
          alpha: 0,
          delay: FLASH_HOLD_MS,
          duration: FLASH_FADE_MS,
          ease: 'Sine.easeIn',
          onComplete: () => flash.setVisible(false),
        });
      },
    });
  }

  /** Re-derive every card/row from state; called on the scene's refresh tick
   * (via `Hud.refresh`) so progress/the countdown update live while open. */
  refresh(state: GameStateData): void {
    const weekly = state.quests.weekly;
    this.countdownText.setText(formatCountdown(weekly.anchor + WEEK_MS - Date.now()));

    for (let i = 0; i < this.weeklyCards.length; i++) {
      const card = this.weeklyCards[i]!;
      const id = weekly.activeIds[i];
      const def = id === undefined ? undefined : WEEKLY_QUESTS.find((quest) => quest.id === id);
      const progress = id === undefined ? null : gameState.questProgress(id);
      if (def === undefined || progress === null) {
        card.currentId = null;
        continue;
      }
      card.currentId = id!;
      card.nameText.setText(def.name);
      card.progressText.setText(this.formatWeeklyProgress(def, progress, weekly.featuredCrop));
      this.applyPrimaryIcon(card.rewardIcons, def.reward, WEEKLY_ICON_SIZE);
      this.applyMoondustIcon(card.rewardIcons, def.reward, WEEKLY_ICON_SIZE);
      this.setClaimState(card.claimButton, card.claimText, progress);
    }

    for (const row of this.longRows) {
      const progress = gameState.questProgress(row.def.id);
      if (progress === null) continue;
      const current = Math.floor(progress.current);
      const target = Math.floor(progress.target);
      row.progressText.setText(`${row.def.progressLabel}: ${current}/${target}`);
      this.setClaimState(row.claimButton, row.claimText, progress);
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(state: GameStateData): void {
    this.visible = !this.visible;
    this.container.setVisible(this.visible);
    this.backdrop.setActive(this.visible);
    setPanelOpen('quests', this.visible);
    if (this.visible) {
      this.refresh(state);
      this.introContainer.setVisible(!state.quests.introSeen);
    } else {
      this.introContainer.setVisible(false);
    }
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
    this.introContainer.setVisible(false);
    this.backdrop.setActive(false);
    setPanelOpen('quests', false);
  }
}
