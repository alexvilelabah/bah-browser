---
name: media-collection
description: Download every song or music video of a soundtrack, album or artist list — research the official track list first, then download each one.
tasks: [download]
priority: 58
---
The user wants a COLLECTION ("all the music videos from the movie X", "the soundtrack", "every song on the album"), not one item.
1. Pick the right work first. An UNDERSTOOD AS line may name the year/artist/edition (e.g. the 1986 Top Gun, not Top Gun: Maverick) — a guess from a small local model; confirm it. Remakes and sequels have different soundtracks.
2. An artist's top N / most famous songs: pick them from your own knowledge and store them (step 4) on your FIRST step — no chart browsing, never narrow to one album. For a soundtrack or album, find the official list: web_search "<movie/album> <year> soundtrack track listing" (e.g. Wikipedia). "All" means the official tracks of THAT work, not random search hits.
3. Save the work with store: key "work", value = "<Title> (<year>)" (e.g. "Top Gun (1986)").
4. Then store key "tracks": an array of "Title — Artist" (["Danger Zone — Kenny Loggins", …]). Always include the artist: Bah searches title + artist + year. That is your last step: Bah asks the user to confirm, downloads every track itself and reports each result.
5. Never download from movie clips, covers or random search hits instead of the listed tracks.
6. If no official list exists, say so and ask the user for the titles.
