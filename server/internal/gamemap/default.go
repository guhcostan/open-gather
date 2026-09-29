package gamemap

import "strings"

// Default builds the bundled starter office (60x36 tiles): reception, twelve
// individual desks, four meeting rooms with different access rules and a
// social area. All layout data is original to this project.
func Default() *Map {
	const W, H = 60, 36
	g := make([][]byte, H)
	for y := range g {
		g[y] = []byte(strings.Repeat(".", W))
	}
	hwall := func(x0, x1, y int) {
		for x := x0; x <= x1; x++ {
			g[y][x] = '#'
		}
	}
	vwall := func(x, y0, y1 int) {
		for y := y0; y <= y1; y++ {
			g[y][x] = '#'
		}
	}
	door := func(x0, y0, x1, y1 int) { // carve a gap (inclusive)
		for y := y0; y <= y1; y++ {
			for x := x0; x <= x1; x++ {
				g[y][x] = '.'
			}
		}
	}
	hwall(0, W-1, 0)
	hwall(0, W-1, H-1)
	vwall(0, 0, H-1)
	vwall(W-1, 0, H-1)
	// Horizontal split between top offices and the social floor.
	hwall(0, W-1, 14)
	door(8, 14, 9, 14)   // reception -> social
	door(30, 14, 31, 14) // desks -> social
	// Reception | desks
	vwall(18, 0, 14)
	door(18, 6, 18, 7)
	// Desks | meeting rooms A and B
	vwall(44, 0, 14)
	door(44, 3, 44, 4)
	door(44, 10, 44, 11)
	hwall(44, W-1, 7)
	// Social | rooms C and D
	vwall(41, 14, H-1)
	door(41, 19, 41, 20)
	door(41, 29, 41, 30)
	hwall(41, W-1, 25)

	walls := make([]string, H)
	for i := range g {
		walls[i] = string(g[i])
	}

	var props []Prop
	add := func(t string, x, y int) { props = append(props, Prop{T: t, X: x, Y: y}) }
	addWH := func(t string, x, y, w, h int) { props = append(props, Prop{T: t, X: x, Y: y, W: w, H: h}) }

	// Reception
	addWH("rug", 6, 8, 6, 4)
	add("reception_desk", 6, 3)
	add("plant", 2, 1)
	add("plant", 16, 1)
	add("couch", 2, 12)
	add("couch", 13, 12)
	add("lamp", 1, 8)

	// Individual desks: 2 rows x 6
	n := 1
	for _, y := range []int{3, 9} {
		for i := 0; i < 6; i++ {
			x := 20 + i*4
			props = append(props, Prop{T: "desk", X: x, Y: y, Label: "Mesa " + itoa(n)})
			add("chair", x, y+1)
			n++
		}
	}
	add("plant", 19, 1)
	add("plant", 42, 1)
	add("bookshelf", 30, 1)

	// Meeting rooms
	room := func(x0, y0, x1, y1 int) {
		cx := (x0 + x1) / 2
		cy := (y0 + y1) / 2
		addWH("table", cx-3, cy-1, 6, 2)
		for i := -3; i < 3; i++ {
			add("chair", cx+i, cy-2)
			add("chair", cx+i, cy+1)
		}
		add("whiteboard", cx-1, y0)
		add("plant", x1, y1)
	}
	room(45, 1, 58, 6)
	room(45, 8, 58, 13)
	room(42, 15, 58, 24)
	room(42, 26, 58, 34)

	// Social area
	addWH("rug", 10, 20, 8, 5)
	addWH("table", 12, 21, 4, 2)
	add("couch", 10, 18)
	add("couch", 15, 18)
	add("couch", 10, 25)
	add("couch", 15, 25)
	add("coffee", 30, 16)
	add("coffee", 31, 16)
	add("plant", 1, 15)
	add("plant", 39, 15)
	add("plant", 1, 33)
	add("plant", 39, 33)
	addWH("table", 26, 26, 4, 2)
	add("chair", 26, 25)
	add("chair", 29, 25)
	add("chair", 26, 28)
	add("chair", 29, 28)
	add("bookshelf", 3, 15)

	areas := []Area{
		{ID: "reception", Name: "Recepção", Kind: "reception", X: 1, Y: 1, W: 17, H: 13, Floor: "wood_light"},
		{ID: "desks", Name: "Mesas individuais", Kind: "desks", X: 19, Y: 1, W: 25, H: 13, Floor: "carpet_blue"},
		{ID: "social", Name: "Área social", Kind: "social", X: 1, Y: 15, W: 40, H: 20, Floor: "wood_warm"},
		{ID: "aurora", Name: "Sala Aurora", Kind: KindRoom, X: 45, Y: 1, W: 14, H: 6, Floor: "carpet_teal", Access: Access{Mode: AccessOpen}, Capacity: 20},
		{ID: "diretoria", Name: "Sala da Diretoria", Kind: KindRoom, X: 45, Y: 8, W: 14, H: 6, Floor: "carpet_plum", Access: Access{Mode: AccessAdmins}, Capacity: 12},
		{ID: "horizonte", Name: "Sala Horizonte", Kind: KindRoom, X: 42, Y: 15, W: 17, H: 10, Floor: "carpet_teal", Access: Access{Mode: AccessOpen}, Capacity: 30},
		{ID: "foco", Name: "Sala Foco (membros)", Kind: KindRoom, X: 42, Y: 26, W: 17, H: 9, Floor: "carpet_green", Access: Access{Mode: AccessMembers}, Capacity: 20},
	}
	return &Map{Version: 1, W: W, H: H, Walls: walls, Props: props, Areas: areas, Spawn: Point{X: 9, Y: 7}}
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}
