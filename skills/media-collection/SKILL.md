---
name: media-collection
description: Download every song or music video of a soundtrack, album or artist list — research the official track list first, then download each one.
tasks: [download]
priority: 58
---
The user wants a COLLECTION ("all the music videos from the movie X", "the soundtrack", "every song on the album"), not one item.
1. Pick the right work first. An UNDERSTOOD AS line may name the year/artist/edition (e.g. the 1986 Top Gun, not Top Gun: Maverick) — it is a guess from a small local model, so confirm it on the page you find. Remakes and sequels have different soundtracks.
2. Find the official list: web_search "<movie/album> <year> soundtrack track listing" (e.g. Wikipedia). "All" means the official tracks of THAT work, not random search hits.
3. Save the work with store: key "work", value = "<Title> (<year>)" (e.g. "Top Gun (1986)").
4. Then save the list with store: key "tracks", value = an array of "Title — Artist" entries (["Danger Zone — Kenny Loggins", "Take My Breath Away — Berlin", …]). Always include the performing artist: Bah searches each track by title + artist + year. That is your last step: Bah then asks the user the quality, downloads every track itself (video with sound for music videos, audio for songs) and reports a table.
5. Never download from movie clips, covers or random search hits instead of the listed tracks.
6. If no official list exists, say so and ask the user for the titles.
