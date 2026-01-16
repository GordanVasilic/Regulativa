
const num = 6;
const fullText = "dr nenad stevandic clan 6.branilastva i u drugim p";
const regexPrefix = new RegExp(`(?:clan|clanak|cl|član|članak|čl|члан|чланак|чл)\\W{0,15}${num}(?:\\..{0,10}|\\b|$)`, 'i');
const match = regexPrefix.exec(fullText);
if (match) {
    console.log("MATCH FOUND at", match.index, ":", match[0]);
} else {
    console.log("MATCH NOT FOUND");
}
