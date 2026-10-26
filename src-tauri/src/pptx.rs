//! Opens a PowerPoint file (Canva's "Download as PowerPoint") for Create to turn into a design.
//! Only unpacking happens here: the slide XML goes to the UI as text, pictures and embedded fonts as
//! data URLs. Sizes are checked as the bytes are read, so a hostile file can't exhaust memory.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Cursor, Read};

const MAX_ENTRIES: usize = 5000;
const MAX_PART: u64 = 64 << 20;
const MAX_TOTAL: u64 = 400 << 20;

#[derive(Serialize, Default, Debug)]
pub struct Package {
    /// XML and relationship parts under ppt/, by path ("ppt/slides/slide1.xml").
    pub parts: BTreeMap<String, String>,
    /// Pictures under ppt/media/ as data URLs, by path.
    pub media: BTreeMap<String, String>,
    /// Embedded fonts under ppt/fonts/ as OpenType data URLs, by path. Fonts that can't be unwrapped are left out.
    pub fonts: BTreeMap<String, String>,
}

fn mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None, // EMF, WMF, video and sound can't be shown in a design
    })
}

pub fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = u32::from(chunk[0]) << 16 | u32::from(*chunk.get(1).unwrap_or(&0)) << 8 | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ABC[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// The OpenType font inside an Embedded OpenType (.fntdata) wrapper. The font data is the last
/// FontDataSize bytes; flag 0x10000000 means it is XORed with 0x50, and 0x4 means MicroType
/// compression, which isn't supported.
pub fn unwrap_eot(eot: &[u8]) -> Option<Vec<u8>> {
    let word = |at: usize| eot.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
    let (size, data_size, flags) = (word(0)? as usize, word(4)? as usize, word(12)?);
    if eot.get(34..36)? != [0x4c, 0x50] || size > eot.len() || data_size > size || flags & 0x4 != 0 {
        return None;
    }
    let mut font = eot[size - data_size..size].to_vec();
    if flags & 0x1000_0000 != 0 {
        font.iter_mut().for_each(|b| *b ^= 0x50);
    }
    // TrueType (00 01 00 00 or "true") or CFF ("OTTO") outlines, nothing else.
    matches!(font.get(..4)?, [0, 1, 0, 0] | b"OTTO" | b"true").then_some(font)
}

pub fn read(bytes: &[u8]) -> Result<Package, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "this isn't a PowerPoint file".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("this file has too many parts".into());
    }
    let (mut package, mut total) = (Package::default(), 0u64);
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Ok(name) = entry.name().map(|n| n.to_string()) else { continue };
        if !name.starts_with("ppt/") || name.contains("..") || entry.is_dir() {
            continue;
        }
        let is_text = name.ends_with(".xml") || name.ends_with(".rels");
        let picture = name.starts_with("ppt/media/").then(|| mime(&name)).flatten();
        let font = name.starts_with("ppt/fonts/") && name.ends_with(".fntdata");
        if !is_text && picture.is_none() && !font {
            continue;
        }
        let mut data = Vec::new();
        entry.take(MAX_PART + 1).read_to_end(&mut data).map_err(|e| format!("{name}: {e}"))?;
        total += data.len() as u64;
        if data.len() as u64 > MAX_PART || total > MAX_TOTAL {
            return Err("this file is too big to import".into());
        }
        if is_text {
            package.parts.insert(name, String::from_utf8(data).map_err(|_| "a slide isn't readable text".to_string())?);
        } else if let Some(mime) = picture {
            package.media.insert(name, format!("data:{mime};base64,{}", base64(&data)));
        } else if let Some(font) = unwrap_eot(&data) {
            let mime = if font.starts_with(b"OTTO") { "font/otf" } else { "font/ttf" };
            package.fonts.insert(name, format!("data:{mime};base64,{}", base64(&font)));
        }
    }
    if !package.parts.contains_key("ppt/presentation.xml") {
        return Err("this isn't a PowerPoint presentation".into());
    }
    Ok(package)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn pptx(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn eot(font: &[u8], flags: u32) -> Vec<u8> {
        let mut out = vec![0u8; 82];
        out[34..36].copy_from_slice(&[0x4c, 0x50]);
        let body: Vec<u8> = font.iter().map(|b| if flags & 0x1000_0000 != 0 { b ^ 0x50 } else { *b }).collect();
        out.extend(&body);
        let size = out.len() as u32;
        out[0..4].copy_from_slice(&size.to_le_bytes());
        out[4..8].copy_from_slice(&(body.len() as u32).to_le_bytes());
        out[12..16].copy_from_slice(&flags.to_le_bytes());
        out
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    #[test]
    fn embedded_fonts_unwrap_plain_and_xored_but_not_compressed() {
        let font = b"OTTO and the rest of a font";
        assert_eq!(unwrap_eot(&eot(font, 0)).unwrap(), font);
        assert_eq!(unwrap_eot(&eot(font, 0x1000_0000)).unwrap(), font);
        assert!(unwrap_eot(&eot(font, 0x4)).is_none(), "MicroType compression isn't supported");
        assert!(unwrap_eot(&eot(b"not a font at all", 0)).is_none());
        assert!(unwrap_eot(b"short").is_none());
        let mut lying = eot(font, 0);
        lying[0..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(unwrap_eot(&lying).is_none(), "sizes past the end are refused");
    }

    #[test]
    fn a_presentation_unpacks_slides_pictures_and_fonts_only() {
        let file = pptx(&[
            ("[Content_Types].xml", b"<Types/>"),
            ("ppt/presentation.xml", b"<p:presentation/>"),
            ("ppt/slides/slide1.xml", b"<p:sld/>"),
            ("ppt/slides/_rels/slide1.xml.rels", b"<Relationships/>"),
            ("ppt/media/image1.png", b"\x89PNG"),
            ("ppt/media/image2.emf", b"emf"),
            ("ppt/fonts/font1.fntdata", &eot(b"OTTO font", 0)),
            ("docProps/thumbnail.jpeg", b"jpeg"),
        ]);
        let p = read(&file).unwrap();
        assert_eq!(p.parts.keys().collect::<Vec<_>>(), ["ppt/presentation.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/slides/slide1.xml"]);
        assert_eq!(p.media.keys().collect::<Vec<_>>(), ["ppt/media/image1.png"]);
        assert_eq!(p.media["ppt/media/image1.png"], "data:image/png;base64,iVBORw==");
        assert_eq!(p.fonts["ppt/fonts/font1.fntdata"], format!("data:font/otf;base64,{}", base64(b"OTTO font")));
    }

    #[test]
    fn other_files_are_refused() {
        assert!(read(b"not a zip").is_err());
        assert!(read(&pptx(&[("word/document.xml", b"<w/>")])).is_err(), "a Word file isn't a presentation");
    }
}
