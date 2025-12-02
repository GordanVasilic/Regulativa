import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'fs-extra'

const LAWS = [
    { title: 'Zakon o slobodnom pristupu informacijama', url: 'https://www.sudovi.me/zakoni/zakon-o-slobodnom-pristupu-informacijama', year: 2017 },
    { title: 'Carinski zakon', url: 'https://www.sudovi.me/zakoni/carinski-zakon', year: 2021 },
    { title: 'Zakon o Ustavnom sudu Crne Gore', url: 'https://www.sudovi.me/zakoni/zakon-o-ustavnom-sudu-crne-gore', year: 2015 }
]

function sanitizeFileName(name: string) {
    return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

async function main() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    })

    try {
        for (const item of LAWS) {
            console.log(`Processing ${item.title}...`)
            const baseName = sanitizeFileName(item.title.trim())
            const suffix = item.year ? `-${item.year}` : ''
            const outPath = path.resolve(`../../Dokumenti/Crna Gora/PDF/${baseName}${suffix}.pdf`)
            const screenshotPath = path.resolve(`../../Dokumenti/Crna Gora/PDF/${baseName}${suffix}_debug.png`)
            const textPath = path.resolve(`../../Dokumenti/Crna Gora/PDF/${baseName}${suffix}.txt`)
            const htmlPath = path.resolve(`../../Dokumenti/Crna Gora/PDF/${baseName}${suffix}.html`)

            console.log(`Target: ${outPath}`)

            const page = await browser.newPage()
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

            // Log requests
            page.on('request', req => {
                if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
                    console.log(`REQ: ${req.url()}`)
                }
            })

            try {
                await page.setViewport({ width: 1280, height: 1024 })
                await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 })

                // Try to find and click cookie button
                try {
                    await new Promise(r => setTimeout(r, 3000))
                    const buttons = await page.$$('button, a, div.q-btn')
                    let clicked = false
                    for (const btn of buttons) {
                        const text = await page.evaluate(el => el.textContent, btn)
                        if (text && text.trim().toLowerCase() === 'prihvati') {
                            console.log('Found cookie button, clicking...')
                            await btn.click()
                            await new Promise(r => setTimeout(r, 2000))
                            clicked = true
                            break
                        }
                    }
                    if (!clicked) console.log('Cookie button not found')
                } catch (e) {
                    console.log('Cookie button logic failed:', e)
                }

                // Wait for content in q-page-container
                try {
                    console.log('Waiting for content...')
                    await page.waitForFunction(() => {
                        const container = document.querySelector('.q-page-container')
                        // @ts-ignore
                        return container && container.innerText.length > 100
                    }, { timeout: 20000 })
                    console.log('Content detected.')
                } catch (e) {
                    console.log('Content wait timeout or error:', e)
                    await page.screenshot({ path: path.resolve(`../../Dokumenti/Crna Gora/PDF/${baseName}${suffix}_error.png`) })
                }

                // Emulate screen media
                await page.emulateMediaType('screen')

                // Scroll
                console.log('Scrolling...')
                await page.evaluate(async () => {
                    await new Promise<void>((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;

                            if (totalHeight >= scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });
                console.log('Scroll done.')

                await page.screenshot({ path: screenshotPath, fullPage: true })
                console.log(`Screenshot saved to ${screenshotPath}`)

                await page.pdf({ path: outPath, format: 'A4', printBackground: true })
                console.log(`✓ Saved to ${outPath}`)

                // Scrape text content
                const textContent = await page.evaluate(() => {
                    const bodyText = document.body.innerText || ''
                    const docText = document.documentElement.innerText || ''
                    const textContent = document.body.textContent || ''
                    console.log(`Body innerText: ${bodyText.length}`)
                    console.log(`Doc innerText: ${docText.length}`)
                    console.log(`Body textContent: ${textContent.length}`)
                    return bodyText || docText || textContent
                })
                console.log(`Received text length: ${textContent.length}`)

                await fs.writeFile(textPath, textContent)
                console.log(`✓ Saved text to ${textPath}`)

                // Dump HTML
                const htmlContent = await page.content()
                await fs.writeFile(htmlPath, htmlContent)
                console.log(`✓ Saved HTML to ${htmlPath}`)

            } catch (e) {
                console.error(`✗ Failed: ${e}`)
            } finally {
                await page.close()
            }
        }
    } finally {
        await browser.close()
    }
}

main()
