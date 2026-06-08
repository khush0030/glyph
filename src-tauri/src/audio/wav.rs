//! Streaming 16 kHz mono Int16 WAV writer (Rust side). The sidecar streams PCM
//! frames; Rust both forwards them to the Transcriber and persists them here so
//! the recording is saved locally (SPEC §11 `notes.audio_path`).

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

pub struct WavWriter {
    file: File,
    data_bytes: u32,
    sample_rate: u32,
}

impl WavWriter {
    pub fn create(path: &Path, sample_rate: u32) -> std::io::Result<Self> {
        let mut file = File::create(path)?;
        let mut w = {
            // reserve the 44-byte header; patched in finalize()
            file.write_all(&[0u8; 44])?;
            Self {
                file,
                data_bytes: 0,
                sample_rate,
            }
        };
        w.write_header()?;
        // seek back to end of header for PCM appends
        w.file.seek(SeekFrom::Start(44))?;
        Ok(w)
    }

    /// Append little-endian Int16 PCM bytes.
    pub fn write_pcm(&mut self, pcm: &[u8]) -> std::io::Result<()> {
        self.file.write_all(pcm)?;
        self.data_bytes += pcm.len() as u32;
        Ok(())
    }

    /// Patch RIFF/data sizes and flush.
    pub fn finalize(mut self) -> std::io::Result<()> {
        self.file.seek(SeekFrom::Start(0))?;
        self.write_header()?;
        self.file.flush()
    }

    fn write_header(&mut self) -> std::io::Result<()> {
        let channels: u16 = 1;
        let bits: u16 = 16;
        let byte_rate = self.sample_rate * u32::from(channels) * u32::from(bits / 8);
        let block_align = channels * (bits / 8);
        let pos = self.file.stream_position()?;
        self.file.seek(SeekFrom::Start(0))?;

        let mut h = Vec::with_capacity(44);
        h.extend_from_slice(b"RIFF");
        h.extend_from_slice(&(36 + self.data_bytes).to_le_bytes());
        h.extend_from_slice(b"WAVE");
        h.extend_from_slice(b"fmt ");
        h.extend_from_slice(&16u32.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes()); // PCM
        h.extend_from_slice(&channels.to_le_bytes());
        h.extend_from_slice(&self.sample_rate.to_le_bytes());
        h.extend_from_slice(&byte_rate.to_le_bytes());
        h.extend_from_slice(&block_align.to_le_bytes());
        h.extend_from_slice(&bits.to_le_bytes());
        h.extend_from_slice(b"data");
        h.extend_from_slice(&self.data_bytes.to_le_bytes());
        self.file.write_all(&h)?;

        // restore position (no-op during finalize since we flush after)
        if pos > 44 {
            self.file.seek(SeekFrom::Start(pos))?;
        }
        Ok(())
    }
}
