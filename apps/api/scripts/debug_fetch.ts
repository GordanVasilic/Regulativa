import 'dotenv/config'
import fs from 'fs-extra'

const URL = 'https://www.sudovi.me/zakoni/zakon-o-slobodnom-pristupu-informacijama'

async function main() {
    console.log(`Fetching ${URL}...`)
    const res = await fetch(URL)
    const text = await res.text()
    console.log(`Response length: ${text.length}`)
    console.log(`Snippet: ${text.slice(0, 500)}`)

    await fs.writeFile('debug_fetch.html', text)
    console.log('Saved to debug_fetch.html')
}

main().catch(console.error)
