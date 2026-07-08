import { describe, it, expect } from "vitest";
import {
  normalizeSpeech,
  parseWakeWord,
  isQuestion,
  matchLocalIntent,
  matchNavIntent,
  navConfirmation,
  navOfferQuestion,
  navLabel,
  matchYesNo,
  BRIEF_SECTIONS,
} from "./conversationHelpers.js";

describe("normalizeSpeech", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeSpeech("  Hey,  ECHO!!  ")).toBe("hey echo");
    expect(normalizeSpeech(null)).toBe("");
  });
});

describe("parseWakeWord", () => {
  it("detects the wake phrase and returns a trailing command", () => {
    const r = parseWakeWord("Hey Echo, what are my leads today?");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("what are my leads today");
  });

  it("matches with no trailing command", () => {
    const r = parseWakeWord("hey echo");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("");
  });

  it("tolerates common mishearings", () => {
    expect(parseWakeWord("hey eco").matched).toBe(true);
    expect(parseWakeWord("hay echo there").matched).toBe(true);
    expect(parseWakeWord("hi echo").matched).toBe(true);
  });

  it("tolerates recognizer mishearings of 'echo'", () => {
    expect(parseWakeWord("hey ecko").matched).toBe(true);
    expect(parseWakeWord("hey ekko").matched).toBe(true);
    expect(parseWakeWord("hey ecco").matched).toBe(true);
    expect(parseWakeWord("hey eko").matched).toBe(true);
    expect(parseWakeWord("hey echoes").matched).toBe(true);
    expect(parseWakeWord("hey echos").matched).toBe(true);
    expect(parseWakeWord("hey gecko").matched).toBe(true);
    expect(parseWakeWord("hey echo ai").matched).toBe(true);
    expect(parseWakeWord("hey echoai").matched).toBe(true);
    expect(parseWakeWord("hey a co").matched).toBe(true);
  });

  it("tolerates mishearings of the greeting and a missing space", () => {
    expect(parseWakeWord("hei echo").matched).toBe(true);
    expect(parseWakeWord("heya echo").matched).toBe(true);
    expect(parseWakeWord("hey there echo").matched).toBe(true);
    expect(parseWakeWord("heyecho").matched).toBe(true);
    expect(parseWakeWord("Hey, Echo — show my leads").matched).toBe(true);
  });

  it("still extracts the command after a misheard wake phrase", () => {
    const r = parseWakeWord("hey ecko show me my leads");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("show me my leads");
  });

  it("does NOT trigger on a bare 'echo' without the leading hey", () => {
    expect(parseWakeWord("the echo of the room was loud").matched).toBe(false);
    expect(parseWakeWord("please echo that back").matched).toBe(false);
    expect(parseWakeWord("echo show me my leads").matched).toBe(false);
    expect(parseWakeWord("there was an echo in the call").matched).toBe(false);
  });

  it("does NOT trigger on similar but unrelated phrases", () => {
    expect(parseWakeWord("hey everyone").matched).toBe(false);
    expect(parseWakeWord("hey how are you").matched).toBe(false);
    expect(parseWakeWord("hey elle").matched).toBe(false);
  });

  it("matches the phrase mid-utterance", () => {
    const r = parseWakeWord("okay so hey echo book me a meeting");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("book me a meeting");
  });
});

describe("isQuestion", () => {
  it("is true only when the reply ends with a question mark", () => {
    expect(isQuestion("What should we do next?")).toBe(true);
    expect(isQuestion("Here is your summary.")).toBe(false);
    expect(isQuestion("Ready when you are.  ")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("matchLocalIntent", () => {
  it("recognizes mute intents", () => {
    expect(matchLocalIntent("mute yourself")).toBe("mute");
    expect(matchLocalIntent("Echo, go quiet")).toBe("mute");
    expect(matchLocalIntent("stop listening please")).toBe("mute");
  });

  it("recognizes patience intents", () => {
    expect(matchLocalIntent("give me a minute")).toBe("patience");
    expect(matchLocalIntent("hold on")).toBe("patience");
    expect(matchLocalIntent("let me think")).toBe("patience");
    expect(matchLocalIntent("one sec")).toBe("patience");
  });

  it("returns null for ordinary commands", () => {
    expect(matchLocalIntent("what are my leads")).toBe(null);
    expect(matchLocalIntent("")).toBe(null);
  });
});

describe("matchNavIntent", () => {
  it("handles every required hands-free navigation command", () => {
    // The exact command set that must work (wake phrase stripped upstream).
    expect(matchNavIntent("go to facebook setup")).toBe("action:facebook");
    expect(matchNavIntent("connect facebook")).toBe("action:facebook");
    expect(matchNavIntent("go to atlas")).toBe("dept:atlas");
    expect(matchNavIntent("show me campaigns")).toBe("campaigns");
    expect(matchNavIntent("go to settings")).toBe("settings");
    expect(matchNavIntent("take me home")).toBe("missioncontrol");
    expect(matchNavIntent("show me my leads")).toBe("leads");
    expect(matchNavIntent("go to sage")).toBe("dept:sage");
    expect(matchNavIntent("show me scout")).toBe("dept:scout");
  });

  it("routes Facebook phrasings to the connect wizard action", () => {
    expect(matchNavIntent("facebook setup")).toBe("action:facebook");
    expect(matchNavIntent("set up facebook")).toBe("action:facebook");
    expect(matchNavIntent("connect my facebook")).toBe("action:facebook");
    expect(matchNavIntent("link facebook")).toBe("action:facebook");
    expect(matchNavIntent("go to facebook")).toBe("action:facebook");
    // Bare "facebook" in a statement/question must NOT hijack navigation.
    expect(matchNavIntent("facebook is expensive")).toBe(null);
    expect(matchNavIntent("how is facebook doing")).toBe(null);
  });

  it("maps 'take me to <section>' commands to section ids", () => {
    expect(matchNavIntent("show me my leads")).toBe("leads");
    expect(matchNavIntent("go to leads")).toBe("leads");
    expect(matchNavIntent("show me the reputation page")).toBe("reputation");
    expect(matchNavIntent("go to settings")).toBe("settings");
    expect(matchNavIntent("show me the portfolio")).toBe("portfolio");
  });

  it("routes each department to its 'dept:<agent>' key (name or role alias)", () => {
    // Proper agent names.
    expect(matchNavIntent("go to atlas")).toBe("dept:atlas");
    expect(matchNavIntent("show me scout")).toBe("dept:scout");
    expect(matchNavIntent("go to nova")).toBe("dept:nova");
    expect(matchNavIntent("show me pulse")).toBe("dept:pulse");
    expect(matchNavIntent("open forge")).toBe("dept:forge");
    expect(matchNavIntent("go to sentinel")).toBe("dept:sentinel");
    // Role / department aliases (agent name not spoken).
    expect(matchNavIntent("marketing director")).toBe("dept:echo");
    expect(matchNavIntent("competitor report")).toBe("dept:scout");
    expect(matchNavIntent("advertising manager")).toBe("dept:atlas");
    expect(matchNavIntent("social media manager")).toBe("dept:nova");
    expect(matchNavIntent("go to crm")).toBe("dept:pulse");
    expect(matchNavIntent("receptionist")).toBe("dept:voice");
  });

  it("routes feature phrases to their own sections (not the owning department)", () => {
    // A section and its department are BOTH reachable by voice: the feature
    // phrase opens the section, the agent name/role opens the department.
    expect(matchNavIntent("show me campaigns")).toBe("campaigns");
    expect(matchNavIntent("show me social media")).toBe("social");
    expect(matchNavIntent("take me to the image studio")).toBe("image");
    expect(matchNavIntent("open video content")).toBe("video");
    expect(matchNavIntent("go to my sales scripts")).toBe("sales");
    expect(matchNavIntent("show me the content calendar")).toBe("contentcalendar");
  });

  it("covers the remaining sections so every section is voice-reachable", () => {
    expect(matchNavIntent("show me the overview")).toBe("overview");
    expect(matchNavIntent("go to my ai team")).toBe("aiteam");
    expect(matchNavIntent("open echo growth")).toBe("echogrowth");
    expect(matchNavIntent("take me to echo memory")).toBe("echomemory");
    expect(matchNavIntent("open voice settings")).toBe("voicesettings");
    expect(matchNavIntent("show me customer intelligence")).toBe("intelligence");
    expect(matchNavIntent("go to capital funding")).toBe("capitalfunding");
    expect(matchNavIntent("open customer feedback")).toBe("feedback");
    expect(matchNavIntent("show me the affiliate program")).toBe("affiliate");
    expect(matchNavIntent("go to the agency workspace")).toBe("agency");
    expect(matchNavIntent("open zapier")).toBe("zapier");
    expect(matchNavIntent("take me to the admin panel")).toBe("admin");
    expect(matchNavIntent("show me the health monitor")).toBe("sentinelhealth");
    expect(matchNavIntent("open call monitoring")).toBe("callmonitor");
    expect(matchNavIntent("go to the sales queue")).toBe("queueoverview");
    expect(matchNavIntent("show me email marketing")).toBe("email");
    expect(matchNavIntent("go to sms")).toBe("sms");
    expect(matchNavIntent("open follow ups")).toBe("followups");
    expect(matchNavIntent("take me to appointments")).toBe("appointments");
    expect(matchNavIntent("show me the chatbot")).toBe("chatbot");
    expect(matchNavIntent("go to phone agent")).toBe("phone");
    expect(matchNavIntent("open my roi dashboard")).toBe("roi");
    expect(matchNavIntent("show me the ad studio")).toBe("adstudio");
  });

  it("routes bare agent names 'voice' and 'sage' to their departments", () => {
    // Regression: "go to Voice" and "go to Sage" previously returned null —
    // the Voice dept regex lacked the bare word and Sage had no target at all.
    expect(matchNavIntent("go to voice")).toBe("dept:voice");
    expect(matchNavIntent("take me to voice")).toBe("dept:voice");
    expect(matchNavIntent("go to sage")).toBe("dept:sage");
    expect(matchNavIntent("show me sage")).toBe("dept:sage");
    expect(matchNavIntent("open the industry brief")).toBe("dept:sage");
    // Bare "voice" needs a nav verb so casual mentions don't hijack navigation.
    expect(matchNavIntent("i like the voice feature")).toBe(null);
  });

  it("keeps multi-word sections from being swallowed by generic ones", () => {
    // "voice settings" must win over the "settings" section and the Voice dept.
    expect(matchNavIntent("open voice settings")).toBe("voicesettings");
    expect(matchNavIntent("go to settings")).toBe("settings");
    // "content calendar" must win over the "calendar"→appointments alias.
    expect(matchNavIntent("show me the content calendar")).toBe("contentcalendar");
    expect(matchNavIntent("take me to the calendar")).toBe("appointments");
    // "health monitor" must win over the bare "sentinel"→dept alias.
    expect(matchNavIntent("show me the health monitor")).toBe("sentinelhealth");
    expect(matchNavIntent("go to sentinel")).toBe("dept:sentinel");
  });

  it("sends 'mission control' / 'go home' to the home section", () => {
    expect(matchNavIntent("mission control")).toBe("missioncontrol");
    expect(matchNavIntent("go home")).toBe("missioncontrol");
    expect(matchNavIntent("take me home")).toBe("missioncontrol");
  });

  it("routes SEO/Google commands to the real 'googleseo' section id", () => {
    // Guards against key drift: the app section is "googleseo", not "seo".
    expect(matchNavIntent("take me to seo")).toBe("googleseo");
    expect(matchNavIntent("open google")).toBe("googleseo");
  });

  it("requires a verb for questionable targets and skips clear questions", () => {
    // Verb-required sections must fall through to Echo without a verb.
    expect(matchNavIntent("what are my leads today")).toBe(null);
    expect(matchNavIntent("how is my reputation")).toBe(null);
    // Even a standalone-capable target must not hijack a question.
    expect(matchNavIntent("how is my social media doing")).toBe(null);
    expect(matchNavIntent("what does the competitor report say")).toBe(null);
    expect(matchNavIntent("")).toBe(null);
  });

  it("does not fire on section words without a nav verb (protects Echo answers)", () => {
    // Sections require a verb, so a bare answer/utterance won't hijack Echo.
    expect(matchNavIntent("share this on social")).toBe(null);
    expect(matchNavIntent("yes launch the campaign")).toBe(null);
    expect(matchNavIntent("email the customer back")).toBe(null);
  });

  it("does not let generic department nouns hijack ordinary statements", () => {
    // These single nouns are department aliases only WITH a nav verb; a plain
    // conversational statement must fall through to Echo, not navigate.
    expect(matchNavIntent("competition is getting worse")).toBe(null);
    expect(matchNavIntent("our crm is behind")).toBe(null);
    expect(matchNavIntent("we need better oversight")).toBe(null);
    expect(matchNavIntent("advertising costs are up")).toBe(null);
    expect(matchNavIntent("i work from home")).toBe(null);
    expect(matchNavIntent("the queue is long today")).toBe(null);
    // ...but the same nouns DO navigate when paired with a nav verb.
    expect(matchNavIntent("go to crm")).toBe("dept:pulse");
    expect(matchNavIntent("take me to advertising")).toBe("dept:atlas");
    expect(matchNavIntent("show me the competition")).toBe("dept:scout");
  });
});

describe("navConfirmation (varied)", () => {
  it("speaks a section-aware confirmation that is never a question", () => {
    for (let i = 0; i < 10; i++) {
      const line = navConfirmation("leads");
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
      expect(isQuestion(line)).toBe(false);
      // Every variant either names the section or is a generic acknowledgment.
      expect(/your leads|taking you there|on it sir/i.test(line)).toBe(true);
    }
  });

  it("names the department (or acknowledges) for 'dept:<agent>' keys", () => {
    for (let i = 0; i < 10; i++) {
      const line = navConfirmation("dept:atlas");
      expect(/atlas|on it sir/i.test(line)).toBe(true);
      expect(isQuestion(line)).toBe(false);
    }
    expect(typeof navConfirmation(null)).toBe("string");
  });

  it("never repeats the same confirmation twice in a row", () => {
    let prev = navConfirmation("leads");
    for (let i = 0; i < 25; i++) {
      const next = navConfirmation("leads");
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

describe("navOfferQuestion", () => {
  it("asks before reading — every offer is a question", () => {
    expect(isQuestion(navOfferQuestion("leads"))).toBe(true);
    expect(isQuestion(navOfferQuestion("campaigns"))).toBe(true);
    expect(isQuestion(navOfferQuestion("dept:sage"))).toBe(true);
    expect(isQuestion(navOfferQuestion("missioncontrol"))).toBe(true);
    expect(isQuestion(navOfferQuestion("roi"))).toBe(true);
  });

  it("special-cases Sage's report and names generic departments", () => {
    for (let i = 0; i < 10; i++) {
      expect(/sage/i.test(navOfferQuestion("dept:sage"))).toBe(true);
      expect(/nova/i.test(navOfferQuestion("dept:nova"))).toBe(true);
    }
  });

  it("rotates offers without repeating the same one twice in a row", () => {
    let prev = navOfferQuestion("leads");
    for (let i = 0; i < 25; i++) {
      const next = navOfferQuestion("leads");
      expect(next).not.toBe(prev);
      expect(isQuestion(next)).toBe(true);
      prev = next;
    }
  });

  it("returns null for pure actions (no read offer)", () => {
    expect(navOfferQuestion("action:facebook")).toBe(null);
    expect(navOfferQuestion(null)).toBe(null);
  });
});

describe("BRIEF_SECTIONS", () => {
  it("maps data-backed nav keys to server brief sections", () => {
    expect(BRIEF_SECTIONS.leads).toBe("leads");
    expect(BRIEF_SECTIONS.campaigns).toBe("campaigns");
    expect(BRIEF_SECTIONS["dept:atlas"]).toBe("campaigns");
    expect(BRIEF_SECTIONS["dept:sage"]).toBe("sage");
    expect(BRIEF_SECTIONS.settings).toBe(undefined);
  });
});

describe("navLabel", () => {
  it("gives a human label for sections and departments", () => {
    expect(navLabel("leads")).toBe("your leads");
    expect(navLabel("dept:sage")).toBe("Sage's department");
    expect(navLabel("missioncontrol")).toBe("Mission Control");
    expect(navLabel("nonsense")).toBe("this section");
  });
});

describe("matchYesNo", () => {
  it("recognizes natural affirmations", () => {
    for (const t of [
      "yes",
      "yes please",
      "sure",
      "yeah go ahead",
      "okay",
      "read it to me",
      "absolutely",
      "let's hear it",
      "go for it",
    ]) {
      expect(matchYesNo(t)).toBe("yes");
    }
  });

  it("recognizes natural declines", () => {
    for (const t of [
      "no",
      "no thanks",
      "nah",
      "not right now",
      "maybe later",
      "I'm good",
      "never mind",
      "no that's okay",
    ]) {
      expect(matchYesNo(t)).toBe("no");
    }
  });

  it("returns null for anything else so it's treated as a new command", () => {
    expect(matchYesNo("take me to my campaigns")).toBe(null);
    expect(matchYesNo("what's my ad spend")).toBe(null);
    expect(matchYesNo("")).toBe(null);
    expect(matchYesNo("play some music")).toBe(null);
  });

  it("a bare polite 'please <command>' is NOT an affirmation", () => {
    expect(matchYesNo("please open my settings")).toBe(null);
    expect(matchYesNo("please")).toBe(null);
    // ...but explicit yes-phrases with please still count.
    expect(matchYesNo("yes please")).toBe("yes");
    expect(matchYesNo("please do")).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// Interrupt commands (barge-in while Echo speaks)
// ---------------------------------------------------------------------------
import {
  matchInterruptIntent,
  matchBriefingIntent,
  matchBriefingChoice,
  BRIEFING_CHOICE_QUESTION,
} from "./conversationHelpers.js";

describe("matchInterruptIntent", () => {
  it("matches short standalone interrupt commands", () => {
    for (const t of [
      "Stop",
      "stop",
      "Cancel",
      "Never mind",
      "nevermind",
      "Wait",
      "That's enough",
      "that is enough",
      "okay stop",
      "stop talking",
      "echo stop",
      "hey echo stop",
      "stop please",
    ]) {
      expect(matchInterruptIntent(t)).toBe(true);
    }
  });

  it("never matches sentences that merely contain an interrupt word (Echo's own speech)", () => {
    for (const t of [
      "you should stop by the leads section for a look",
      "we can't wait to see how the campaign performs this week",
      "that's enough budget to run three more ad sets this month",
      "your campaign will stop on Friday",
      "",
    ]) {
      expect(matchInterruptIntent(t)).toBe(false);
    }
  });
});

describe("matchBriefingIntent", () => {
  it("recognizes on-demand briefing requests", () => {
    for (const t of [
      "give me my briefing",
      "brief me",
      "can you catch me up",
      "fill me in",
      "what's been happening",
      "give me an update",
      "bring me up to speed",
    ]) {
      expect(matchBriefingIntent(t)).toBe(true);
    }
  });

  it("ignores unrelated commands", () => {
    expect(matchBriefingIntent("take me to my leads")).toBe(false);
    expect(matchBriefingIntent("play some jazz")).toBe(false);
    expect(matchBriefingIntent("")).toBe(false);
  });
});

describe("matchBriefingChoice", () => {
  it("asks the exact scripted question", () => {
    expect(BRIEFING_CHOICE_QUESTION).toBe(
      "Of course Sir. Would you like a full briefing covering all your businesses, a quick summary of the most important things right now, or a specific update on one business or topic?",
    );
  });

  it("detects a full briefing", () => {
    for (const t of [
      "the full briefing",
      "full",
      "everything",
      "cover all my businesses",
      "the whole thing",
      "all of it",
    ]) {
      expect(matchBriefingChoice(t)).toBe("full");
    }
  });

  it("detects a quick summary", () => {
    for (const t of [
      "a quick summary",
      "just the highlights",
      "the most important things",
      "quick",
      "short one",
    ]) {
      expect(matchBriefingChoice(t)).toBe("quick");
    }
  });

  it("treats anything else as a specific topic", () => {
    expect(matchBriefingChoice("how is my restaurant doing")).toBe("specific");
    expect(matchBriefingChoice("update on the facebook campaign")).toBe("specific");
  });

  it("declines cleanly", () => {
    expect(matchBriefingChoice("no")).toBe("none");
    expect(matchBriefingChoice("never mind")).toBe("none");
    expect(matchBriefingChoice("")).toBe("none");
  });
});


// ---------------------------------------------------------------------------
// Speech-pattern learning + Southern/slang canonicalization
// ---------------------------------------------------------------------------
import {
  matchStatusIntent,
  matchLearnedPhrase,
  resolveLearnableAction,
  LEARNABLE_ACTIONS,
  CLARIFY_QUESTION,
  CONFIDENCE_THRESHOLD,
} from "./conversationHelpers.js";

describe("Southern/slang canonicalization (normalizeSpeech)", () => {
  it("rewrites casual contractions", () => {
    expect(normalizeSpeech("gimme the rundown")).toBe("give me the rundown");
    expect(normalizeSpeech("lemme hear it")).toBe("let me hear it");
    expect(normalizeSpeech("I'm fixin to leave")).toBe("i m about to leave");
    expect(normalizeSpeech("howdy echo")).toBe("hey echo");
    expect(normalizeSpeech("naw")).toBe("no");
    expect(normalizeSpeech("yessir")).toBe("yes sir");
    expect(normalizeSpeech("aight")).toBe("okay");
  });
  it("fixes dropped-g command verbs only", () => {
    expect(normalizeSpeech("stop talkin")).toBe("stop talking");
    expect(normalizeSpeech("what's happenin")).toBe("what s happening");
    expect(normalizeSpeech("nothin")).toBe("nothing");
    // unknown words are left alone
    expect(normalizeSpeech("griffin")).toBe("griffin");
  });
  it("keeps standard speech untouched", () => {
    expect(normalizeSpeech("Take me to my leads")).toBe("take me to my leads");
  });
});

describe("slang command mappings", () => {
  it("hold up / kill it / cut it interrupt", () => {
    expect(matchInterruptIntent("hold up")).toBe(true);
    expect(matchInterruptIntent("kill it")).toBe(true);
    expect(matchInterruptIntent("kill everything")).toBe(true);
    expect(matchInterruptIntent("shut it down")).toBe(true);
    expect(matchInterruptIntent("cut it")).toBe(true);
    expect(matchInterruptIntent("hey echo hold on")).toBe(true);
  });
  it("bet / run it / let's go mean yes", () => {
    expect(matchYesNo("bet")).toBe("yes");
    expect(matchYesNo("run it")).toBe("yes");
    expect(matchYesNo("let's go")).toBe("yes");
    expect(matchYesNo("send it")).toBe("yes");
    expect(matchYesNo("yessir")).toBe("yes");
  });
  it("nah / naw mean no", () => {
    expect(matchYesNo("nah")).toBe("no");
    expect(matchYesNo("naw")).toBe("no");
  });
  it("what's good means give me an update", () => {
    expect(matchBriefingIntent("what's good")).toBe(true);
    expect(matchBriefingIntent("gimme the rundown")).toBe(true);
    expect(matchBriefingIntent("how we lookin")).toBe(true);
  });
  it("real quick means a quick summary", () => {
    expect(matchBriefingChoice("real quick")).toBe("quick");
    expect(matchBriefingChoice("just real quick")).toBe("quick");
  });
});

describe("matchStatusIntent", () => {
  it("matches direct status asks", () => {
    expect(matchStatusIntent("what we got")).toBe(true);
    expect(matchStatusIntent("what do we got")).toBe(true);
    expect(matchStatusIntent("show me the current status")).toBe(true);
    expect(matchStatusIntent("status report")).toBe(true);
    expect(matchStatusIntent("hey echo what we got today")).toBe(true);
  });
  it("does not match sentences merely containing status words", () => {
    expect(matchStatusIntent("tell me what we got planned for the campaign next month")).toBe(false);
    expect(matchStatusIntent("the status of that invoice is unpaid")).toBe(false);
  });
});

describe("learned phrases", () => {
  const learned = new Map([
    ["squash it", "stop"],
    ["holler at me", "briefing"],
    ["whats cookin", "status"],
  ]);
  it("matches an exact learned phrase after normalization", () => {
    expect(matchLearnedPhrase("Squash it!", learned)).toBe("stop");
    expect(matchLearnedPhrase("holler at me", learned)).toBe("briefing");
  });
  it("never matches inside a longer sentence", () => {
    expect(matchLearnedPhrase("please do not squash it when you file that", learned)).toBe(null);
  });
  it("ignores unknown actions and missing maps", () => {
    expect(matchLearnedPhrase("squash it", new Map([["squash it", "rm -rf"]]))).toBe(null);
    expect(matchLearnedPhrase("squash it", null)).toBe(null);
  });
});

describe("resolveLearnableAction", () => {
  it("maps understood repeats to actions", () => {
    expect(resolveLearnableAction("stop")).toBe("stop");
    expect(resolveLearnableAction("what we got")).toBe("status");
    expect(resolveLearnableAction("catch me up")).toBe("briefing");
    expect(resolveLearnableAction("yes")).toBe("yes");
    expect(resolveLearnableAction("nah")).toBe("no");
    expect(resolveLearnableAction("purple elephants")).toBe(null);
  });
});

describe("clarification constants", () => {
  it("asks the exact natural clarification", () => {
    expect(CLARIFY_QUESTION).toBe(
      "I didn't quite catch that Sir, could you say that again?",
    );
  });
  it("threshold is a sane fraction", () => {
    expect(CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
  it("learnable actions include the core set", () => {
    for (const a of ["stop", "yes", "no", "briefing", "status"]) {
      expect(LEARNABLE_ACTIONS).toContain(a);
    }
  });
});

import {
  matchBriefingStart,
  MORNING_STANDBY_GREETING,
  MORNING_MUSIC_READY_LINE,
  matchMusicIntent,
} from "./conversationHelpers.js";

describe("morning standby (matchBriefingStart)", () => {
  it("greeting is the exact standby line", () => {
    expect(MORNING_STANDBY_GREETING).toBe(
      "Good morning Sir. I will be on standby waiting for you to start your morning briefing.",
    );
  });
  it("explicit start phrases work", () => {
    expect(matchBriefingStart("start my briefing")).toBe(true);
    expect(matchBriefingStart("hey echo start my morning briefing")).toBe(true);
    expect(matchBriefingStart("start the briefing")).toBe(true);
    expect(matchBriefingStart("I'm ready")).toBe(true);
    expect(matchBriefingStart("ready")).toBe(true);
    expect(matchBriefingStart("let's do it")).toBe(true);
  });
  it("regular briefing requests count", () => {
    expect(matchBriefingStart("what's good")).toBe(true);
    expect(matchBriefingStart("catch me up")).toBe(true);
    expect(matchBriefingStart("gimme the rundown")).toBe(true);
  });
  it("short go-ahead barks count, on their own only", () => {
    expect(matchBriefingStart("run it")).toBe(true);
    expect(matchBriefingStart("let's go")).toBe(true);
    expect(matchBriefingStart("bet")).toBe(true);
    expect(matchBriefingStart("yeah I was gonna say we should maybe do it later")).toBe(false);
  });
  it("negatives and unrelated speech do not start it", () => {
    expect(matchBriefingStart("nah not now")).toBe(false);
    expect(matchBriefingStart("play some music")).toBe(false);
    expect(matchBriefingStart("take me to my leads")).toBe(false);
    expect(matchBriefingStart("")).toBe(false);
  });
});

describe("matchMusicIntent — saved favorites", () => {
  it("playlist/music/favorites phrasings start the saved list", () => {
    expect(matchMusicIntent("start my music")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play my morning playlist")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play my morning music")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play some of my favorites")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("hey echo play my favorite songs")).toEqual({ action: "favorites", index: 0 });
  });
  it("song-number requests map to the 0-based index", () => {
    expect(matchMusicIntent("play song number two")).toEqual({ action: "favorites", index: 1 });
    expect(matchMusicIntent("play track 5")).toEqual({ action: "favorites", index: 4 });
    expect(matchMusicIntent("play my favorite number one")).toEqual({ action: "favorites", index: 0 });
  });
  it("ordinal phrasings ('my second song') map to the 0-based index", () => {
    expect(matchMusicIntent("hey echo play my second song")).toEqual({
      action: "favorites",
      index: 1,
    });
    expect(matchMusicIntent("play my first song")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play the 3rd track")).toEqual({ action: "favorites", index: 2 });
    expect(matchMusicIntent("play my fifth favorite")).toEqual({ action: "favorites", index: 4 });
  });
  it("generic 'the music' phrasing stays generic play, not favorites", () => {
    expect(matchMusicIntent("play the music")).toEqual({ action: "play", value: "" });
    expect(matchMusicIntent("start playing the music")).toEqual({ action: "play", value: "" });
    expect(matchMusicIntent("play the playlist")).toEqual({ action: "favorites", index: 0 });
  });
  it("search-style play requests still go to YouTube search", () => {
    expect(matchMusicIntent("play some AC/DC")).toEqual({ action: "play", value: "ac dc" });
    expect(matchMusicIntent("play some jazz")).toEqual({ action: "play", value: "jazz" });
  });
  it("skip and stop keep working", () => {
    expect(matchMusicIntent("next song")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip this one")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip that song please")).toEqual({ action: "skip" });
    expect(matchMusicIntent("stop the music")).toEqual({ action: "stop" });
  });
  it("pause still works as a bare command or with a music noun", () => {
    expect(matchMusicIntent("pause")).toEqual({ action: "pause" });
    expect(matchMusicIntent("pause the music")).toEqual({ action: "pause" });
    expect(matchMusicIntent("hold the music")).toEqual({ action: "pause" });
  });
  it("sentences merely containing skip/next/pause do NOT hijack music", () => {
    expect(matchMusicIntent("what's next on my calendar")).toBe(null);
    expect(matchMusicIntent("skip the intro and show me my leads")).toBe(null);
    expect(matchMusicIntent("put a pause on that campaign")).toBe(null);
    expect(matchMusicIntent("hold my calls this afternoon")).toBe(null);
    expect(matchMusicIntent("what should we do next about the ads")).toBe(null);
  });
  it("non-music speech does not match", () => {
    expect(matchMusicIntent("what are my leads today")).toBe(null);
    expect(matchMusicIntent("")).toBe(null);
  });
});

describe("MORNING_MUSIC_READY_LINE", () => {
  it("is the exact playlist-ready sentence", () => {
    expect(MORNING_MUSIC_READY_LINE).toBe(
      "Your morning playlist is ready whenever you want it Sir.",
    );
  });
});

// ---------------------------------------------------------------------------
// Guided-tour voice commands
// ---------------------------------------------------------------------------
import { matchTourCommand } from "./conversationHelpers.js";

describe("matchTourCommand", () => {
  it("yes-style answers advance the tour", () => {
    expect(matchTourCommand("yes")).toBe("next");
    expect(matchTourCommand("Yes sir")).toBe("next");
    expect(matchTourCommand("yeah")).toBe("next");
    expect(matchTourCommand("sure")).toBe("next");
  });
  it("next/continue phrasing advances the tour", () => {
    expect(matchTourCommand("next")).toBe("next");
    expect(matchTourCommand("next one")).toBe("next");
    expect(matchTourCommand("keep going")).toBe("next");
    expect(matchTourCommand("continue")).toBe("next");
    expect(matchTourCommand("I'm ready")).toBe("next");
    expect(matchTourCommand("go ahead")).toBe("next");
  });
  it("back goes back", () => {
    expect(matchTourCommand("back")).toBe("back");
    expect(matchTourCommand("go back")).toBe("back");
  });
  it("stop-style barks end the tour", () => {
    expect(matchTourCommand("stop")).toBe("stop");
    expect(matchTourCommand("that's enough")).toBe("stop");
    expect(matchTourCommand("cancel")).toBe("stop");
  });
  it("ordinary sentences do not drive the tour", () => {
    expect(matchTourCommand("this is your lead inbox where leads land")).toBe(null);
    expect(matchTourCommand("what are my leads today")).toBe(null);
    expect(matchTourCommand("")).toBe(null);
    // Echo's own narration contains these words mid-sentence — must not match.
    expect(matchTourCommand("ready to see the next one sir")).toBe(null);
  });
});
