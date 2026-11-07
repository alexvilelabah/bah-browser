---
name: popup-dismiss
description: Close sign-in, cookie, newsletter and promo dialogs that block the page.
states: [dialog]
priority: 50
---
A dialog/popup is open over the page. While it is open, the page behind it is inert: its fields and buttons are missing from INTERACTIVE ELEMENTS, and anything you type goes into the popup instead.
1. Unless the popup itself is what the task needs (e.g. a login you were asked to do), close it first: click its close/dismiss control (×, "Close", "Dismiss", "No thanks", "Not now", "Maybe later"). The OPEN DIALOG line at the top names the [id] when Bah found it.
2. No close button listed? Use press "Escape", or click_ref on an empty area outside the dialog.
3. Re-check the next observation: the page's own fields should now be listed. Only then type or click on the page.
Promotions: almost all just need dismissing. If one shows a coupon/discount relevant to the task, Bah saves its text to MEMORY — mention it in your answer, then dismiss.
Never sign in, sign up or enter an email just to get rid of a popup.
