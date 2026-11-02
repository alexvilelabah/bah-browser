---
name: media-collection
description: Download every song or music video of a soundtrack, album or artist list — research the official track list first, then download each one.
tasks: [download]
priority: 58
---
The user wants a COLLECTION ("all the music videos from the movie X", "the soundtrack", "every song on the album"), not one item.
1. Find the official list first: web_search "<movie/album> soundtrack track listing" (e.g. Wikipedia). "All" means the official tracks, not random search hits.
2. Save the list with store: key "tracks", value = an array of the titles (["Danger Zone", "Take My Breath Away", …]). That is your last step: Bah then asks the user the quality, downloads every track itself (video with sound for music videos, audio for songs) and reports a table.
3. Never download from movie clips, covers or random search hits instead of the listed tracks.
4. If no official list exists, say so and ask the user for the titles.
