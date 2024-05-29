const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

async function findPuzzlePosition(page) {
    console.log('Finding puzzle position...');
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

    await fs.writeFile(`./puzzle.png`, images[1], 'base64')

    let srcPuzzleImage = await Jimp.read('./puzzle.png')
    let srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap)
    let dstPuzzle = new cv.Mat()

    cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY)
    cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY)

    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)
    cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1)
    cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    console.log('Puzzle position found');
    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function findDiffPosition(page) {
    console.log('Finding difference position...');
    await page.waitFor(100)

    let srcImage = await Jimp.read('./diff.png')
    let src = cv.matFromImageData(srcImage.bitmap)

    let dst = new cv.Mat()
    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)

    cv.threshold(src, dst, 127, 255, cv.THRESH_BINARY)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)

    cv.cvtColor(dst, dst, cv.COLOR_BGR2GRAY)
    cv.threshold(dst, dst, 150, 255, cv.THRESH_BINARY_INV)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    console.log('Difference position found');
    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function saveSliderCaptchaImages(page) {
    console.log('Saving slider captcha images...');
    await page.waitForSelector('.tab-item.tab-item-1')
    await page.click('.tab-item.tab-item-1')

    await page.waitForSelector('[aria-label="Click to verify"]')
    await page.waitFor(1000)

    await page.click('[aria-label="Click to verify"]')

    await page.waitForSelector('.geetest_canvas_img canvas', { visible: true })
    await page.waitFor(1000)
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => {
        return canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, ''))
    })

    await fs.writeFile(`./captcha.png`, images[0], 'base64')
    await fs.writeFile(`./original.png`, images[2], 'base64')
    console.log('Slider captcha images saved');
}

async function saveDiffImage() {
    console.log('Saving difference image...');
    const originalImage = await Jimp.read('./original.png')
    const captchaImage = await Jimp.read('./captcha.png')

    const { width, height } = originalImage.bitmap
    const diffImage = new Jimp(width, height)

    const diffOptions = { includeAA: true, threshold: 0.2 }

    pixelmatch(originalImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions)
    diffImage.write('./diff.png')
    console.log('Difference image saved');
}

async function run() {
    try {
        const browser = await puppeteer.launch({
            headless: true, // mode headless
            defaultViewport: { width: 1366, height: 768 }
        })
        const page = await browser.newPage()

        console.log('Navigating to the page...');
        await page.goto('https://www.geetest.com/en/demo', { waitUntil: 'networkidle2' })

        await page.waitFor(1000)

        await saveSliderCaptchaImages(page)
        await saveDiffImage()

        let [cx, cy] = await findDiffPosition(page)

        const sliderHandle = await page.$('.geetest_slider_button')
        const handle = await sliderHandle.boundingBox()

        let xPosition = handle.x + handle.width / 2
        let yPosition = handle.y + handle.height / 2
        await page.mouse.move(xPosition, yPosition)
        await page.mouse.down()

        xPosition = handle.x + cx - handle.width / 2
        yPosition = handle.y + handle.height / 3
        await page.mouse.move(xPosition, yPosition, { steps: 25 })

        await page.waitFor(100)

        let [cxPuzzle, cyPuzzle] = await findPuzzlePosition(page)

        xPosition = xPosition + cx - cxPuzzle
        yPosition = handle.y + handle.height / 2
        await page.mouse.move(xPosition, yPosition, { steps: 5 })
        await page.mouse.up()

        // Attendre et vérifier l'indicateur de succès
        console.log('Verifying CAPTCHA success...');
        const success = await page.waitForSelector('.geetest_success_radar_tip_content', { timeout: 5000 }).then(() => true).catch(() => false);

        if (success) {
            console.log('Captcha solved!');
        } else {
            console.log('Captcha not solved.');
        }

        // Nettoyage des fichiers temporaires
        await fs.unlink('./original.png')
        await fs.unlink('./captcha.png')
        await fs.unlink('./diff.png')
        await fs.unlink('./puzzle.png')

        await browser.close()
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

run()