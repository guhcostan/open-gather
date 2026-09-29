// ivffix renumbers the frame timestamps of an IVF file to 0, 1, 2, ... so that a player using the header
// timebase (1/fps) paces frames at the real frame rate. ffmpeg's IVF muxer can write timestamps in
// another unit, which made the SDK's file track send one frame per second.
package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: ivffix in.ivf out.ivf")
		os.Exit(2)
	}
	in, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	out, err := os.Create(os.Args[2])
	if err != nil {
		panic(err)
	}
	defer out.Close()
	out.Write(in[:32])
	off, n := 32, uint64(0)
	for off+12 <= len(in) {
		size := int(binary.LittleEndian.Uint32(in[off:]))
		if off+12+size > len(in) {
			break
		}
		var h [12]byte
		binary.LittleEndian.PutUint32(h[:4], uint32(size))
		binary.LittleEndian.PutUint64(h[4:], n)
		out.Write(h[:])
		out.Write(in[off+12 : off+12+size])
		off += 12 + size
		n++
	}
	fmt.Println("frames:", n)
	_ = io.EOF
}
