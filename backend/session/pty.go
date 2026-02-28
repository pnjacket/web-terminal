package session

import (
	"io"
	"log"
	"os/exec"
	"time"

	"github.com/creack/pty"
)

func spawnPTY(s *Session, onExit func(id string)) error {
	cmd := exec.Command("bash", "--login")
	cmd.Env = append(cmd.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return err
	}
	s.ptmx = ptmx
	s.cmd = cmd

	go readLoop(s, onExit)
	return nil
}

func readLoop(s *Session, onExit func(id string)) {
	buf := make([]byte, 4096)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])

			s.scrollback.Write(data)
			s.LastActive = time.Now()

			s.outMu.Lock()
			if s.outChan != nil {
				select {
				case s.outChan <- data:
				default:
				}
			}
			s.outMu.Unlock()
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("session %s PTY read error: %v", s.ID, err)
			}
			close(s.done)
			onExit(s.ID)
			return
		}
	}
}
