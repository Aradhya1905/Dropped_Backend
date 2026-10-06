/**
 * starterPool — the hand-written text for starter drops, and the system device
 * that authors them.
 *
 * Starter drops are seeded into empty areas so a new user never opens to a
 * blank map. They are labelled as starters and written as invitations, not
 * fake confessions: the app's promise is that real strangers leave the rest.
 * Edit freely — keep each body under MAX_BODY_LENGTH (280) and the tone true.
 */
import type { Mood } from './clientTypes.js';

/** Author of every starter drop. Distinct from the seed script's device. */
export const STARTER_DEVICE_ID = '00000000-0000-4000-8000-000000000001';

/** Place label shown wherever a starter drop's place name renders. */
export const STARTER_PLACE_LABEL = 'A starter drop';

export interface StarterText {
  body: string;
  mood: Mood;
}

export const STARTER_POOL: readonly StarterText[] = [
  // joy
  { mood: 'joy', body: 'First seal you’ve broken. Every other one on this map was left by someone who stood exactly where they dropped it.' },
  { mood: 'joy', body: 'Somewhere near here, someone once had the best day of their life. Maybe it was you. Leave a note about it.' },
  { mood: 'joy', body: 'You walked here for a few words from a stranger. That’s a lovely thing to do. Someone will do the same for yours.' },
  { mood: 'joy', body: 'Think of the last time you laughed so hard it hurt. Drop it here, so the next person walking by gets a little of it.' },
  { mood: 'joy', body: 'Small good news counts. Got the job, passed the test, they texted back. Pin it somewhere it happened.' },
  { mood: 'joy', body: 'This street has seen first dates, last days, and a thousand ordinary Tuesdays. Add yours.' },
  { mood: 'joy', body: 'You found this by walking. Most people never look up from their phones long enough to notice what’s left behind.' },
  // ache
  { mood: 'ache', body: 'Is there a place that still feels like someone who’s gone? You can leave them a few words there. Nobody will know it’s you.' },
  { mood: 'ache', body: 'Some things are easier to say to a stranger than to anyone you know. That’s what this is for.' },
  { mood: 'ache', body: 'A secret you carry is heavy. A secret you set down somewhere is just a story. Find a spot and set one down.' },
  { mood: 'ache', body: 'The things we never said tend to stay in the places we didn’t say them. Go back to one. Say it there.' },
  { mood: 'ache', body: 'Missing someone you can’t call? Write it here. Whoever finds it will understand more than you’d think.' },
  { mood: 'ache', body: 'Every bench, corner and bus stop near you has held someone’s worst day. Kindness left here gets found.' },
  // trouble
  { mood: 'trouble', body: 'Tell this street one thing you’ve never said out loud. It’ll keep it.' },
  { mood: 'trouble', body: 'No name, no profile, no followers. Just a place and a few words. What would you say if nobody could trace it back?' },
  { mood: 'trouble', body: 'Everyone has a confession that’s more funny than terrible. Start with that one.' },
  { mood: 'trouble', body: 'You don’t have to be brave to leave a secret here. You just have to be standing somewhere.' },
  { mood: 'trouble', body: 'The rule here: be honest, be kind, don’t name anyone. Cruelty gets erased. Truth stays.' },
  { mood: 'trouble', body: 'Something you did that you’re still not sure was right? The person who reads it won’t judge. They’ll just stand here and think.' },
  { mood: 'trouble', body: 'Somebody will read your words standing exactly where you wrote them. Make it worth the walk.' },
  // wonder
  { mood: 'wonder', body: 'Someone will stand right where you are one day, wondering what you left here. Leave them something.' },
  { mood: 'wonder', body: 'Look around. What’s the strangest thing that ever happened to you within sight of this spot?' },
  { mood: 'wonder', body: 'Every map has hidden layers. This is one: words pinned to places, only readable if you show up.' },
  { mood: 'wonder', body: 'Secrets are like seeds. This one was planted so others would grow nearby. Plant one of yours.' },
  { mood: 'wonder', body: 'You can’t read these from your couch. You had to come here. That’s the whole idea.' },
  { mood: 'wonder', body: 'There’s a version of this street that only exists in people’s memories. Write a piece of it down.' },
  { mood: 'wonder', body: 'Pick a place that matters to you — a window, a tree, a corner shop — and leave it a note. Someone will walk there for it.' },
  { mood: 'wonder', body: 'If you could whisper one thing to the next stranger who stands here, what would it be?' },
  { mood: 'wonder', body: 'This drop will fade in a few weeks. The ones real people leave are what make the map worth walking.' },
  { mood: 'wonder', body: 'Take a slow look around before you go. You’re standing somewhere that mattered to somebody.' },
];
