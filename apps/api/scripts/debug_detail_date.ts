import * as cheerio from 'cheerio'

const url = process.argv[2] || 'https://www.narodnaskupstinars.net/?q=la/akti/usvojeni-zakoni/zakon-o-turizmu-0'

async function fetchText(u: string) {
  const res = await fetch(u, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function logAround(haystack: string, needle: RegExp, span = 200) {
  const m = haystack.match(needle)
  if (!m) {
    console.log('No match for', needle)
    return
  }
  const idx = haystack.indexOf(m[0])
  const s = Math.max(0, idx - span)
  const e = Math.min(haystack.length, idx + span)
  console.log(haystack.slice(s, e))
}

async function main() {
  const html = await fetchText(url)
  const $ = cheerio.load(html)
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  console.log('Body length:', text.length)
  logAround(text, /Datum/i)
  logAround(text, /Službeni glasnik/i)
  logAround(text, /45\/(17|2017)/)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})