---
name: media-collection
description: Download every song or music video of a soundtrack, album or artist list — research the official track list first, then download each one.
tasks: [download]
priority: 58
---
The user wants a COLLECTION ("all the music videos from the movie X", "the soundtrack", "every song on the album"), not one item.
1. Find the official list first: web_search "<movie/album> soundtrack track listing" (e.g. Wikipedia). "All" means the official tracks, not random search hits.
2. Write the list down with store/plan: one line per track, "Artist – Title".
3. More than 5 items, or the user said "video"/"4K": ask once which quality (e.g. best, 1080p, 720p) and say roughly how many files; the user may trim the list.
4. Music VIDEO = video with sound (not audio-only). Song/track/mp3 = audio-only.
5. Download each track with its own download_video, query "Artist – Title official music video" (or "… audio" for songs). Send them as one batch of actions so Bah queues them.
6. A track with no official video: say so; never substitute a movie clip or a cover without asking.
7. Bah waits for all downloads to finish; then report a table: track, file, done/failed.
