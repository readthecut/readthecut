# ReadTheCut

A training app for judging the aim on cut shots in pool. You look at a layout the way you would standing at the table, then pick which down-on-the-shot view has the correct aim.

## Language

### The shot

**Shot**:
One cue ball, one object ball and a target pocket on a table of one Table Format. This is the unit that each question is built from.
_Avoid_: Layout, scenario, rack

**Table Format**:
A named table setup that fixes table size, ball sizes and pocket mouths: US 9ft, US 7ft bar box, UK blackball or Chinese 8-ball.
_Avoid_: Table type, game, ruleset

**Cut Angle**:
The angle between the cue ball's line of travel and the object ball's line to the pocket. 0° is a straight-in shot.
_Avoid_: Cut, angle

**Ghost Ball**:
The position the cue ball must occupy at contact for the object ball to travel to the pocket.
_Avoid_: Contact position

**Aim Point**:
The point the cue is aimed at: the centre of the Ghost Ball as seen down the cue.
_Avoid_: Target, aim spot

**Throw**:
The small sideways push that friction between the balls gives the object ball at contact. It is ignored for now: "correct" means pure geometry.
_Avoid_: Correction, deflection

**Overcut**:
A miss from hitting the object ball too thin, so it turns more than the Cut Angle needs.
_Avoid_: Too much cut, thin miss

**Undercut**:
A miss from hitting the object ball too full, so it doesn't turn enough.
_Avoid_: Too little cut, thick miss

### The question

**Standing View**:
The question image. It shows the Shot from eye height, a step behind the cue ball, looking along the line from the cue ball to the object ball.
_Avoid_: Question view, overview

**Aim View**:
A first-person view from down on the shot, looking along the cue at a candidate Aim Point. The cue stays centred, and the balls and table sit around it.
_Avoid_: Going-down view, cue view, POV

**Vision Centre**:
Where the eye sits sideways relative to the cue in the Aim View. For now it is always directly above the cue.
_Avoid_: Dominant eye, eye offset

**Choice**:
One Aim View offered as an answer. Each question has four Choices, and exactly one is correct.
_Avoid_: Option, answer

**Distractor**:
A wrong Choice. Its Aim Point always sends the object ball past the pocket. Some miss narrowly, others clearly.
_Avoid_: Wrong answer, decoy

**Reveal**:
The feedback shown after picking a Choice: a top-down diagram of the correct and chosen lines, where the object ball went, and the Cut Angle.
_Avoid_: Result, explanation

### Practice

**Set**:
A run of 10 questions with a score at the end.
_Avoid_: Round, quiz, session

**Endless**:
A practice mode with no fixed length.
_Avoid_: Free play, infinite mode

**Cut Angle Band**:
A 15° range of Cut Angles (0–15°, 15–30°, …) that accuracy is tracked by.
_Avoid_: Bucket, difficulty tier

**Daily**:
Five Shots that are the same for every player on a given local calendar day, on US 9ft at Medium. There is one attempt per day.
_Avoid_: Daily challenge, puzzle of the day

**Streak**:
The number of consecutive days with a completed Daily.
_Avoid_: Run, chain

### Sharing

**Shot Link**:
A URL that rebuilds one exact Shot for anyone who opens it.
_Avoid_: Challenge link, permalink

**Share Grid**:
The spoiler-free emoji line for a Daily or Set: one square per Shot, showing correct, Overcut or Undercut.
_Avoid_: Result card, emoji score
