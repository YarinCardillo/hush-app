# Vesper — Threshold Moments (TODO)

Future work to give Vesper presence at significant server transitions.

## Philosophy

Vesper non ha funzionalita — ha presenza. It appears at moments of transition,
then disappears. Not a bot, not a feature — a gesture.

## Planned Threshold Triggers

### 1. Server Creation
When a user creates a new server, Vesper appears briefly as a welcome moment.
Exit: fade after ~5s OR on first user interaction (whichever comes first).

### 2. New Channel Arrival
When a user navigates to a channel for the first time, Vesper does a micro-moment.
Exit: same fade logic.

### 3. First Server Visit
First time a user enters a server they joined. Needs "seen" state tracking (localStorage).
Exit: same fade logic.

### 4. New Member Onboarding
When a new user joins a server, Vesper does a silent welcome gesture visible to that user.
Needs server-side member_joined event + client-side "is this me?" check.

## Per-Server Customization (Later)
Each server's admin can pick a custom accent color and name for their Vesper.
Deferred — ships with default orange identity for now.

## Exit Behavior
All threshold appearances use: auto-fade after ~5s OR fade on first user interaction,
whichever comes first. CSS opacity transition + unmount after animation.
