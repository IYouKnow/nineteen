package services

import "testing"

func TestPickAppContainerPort(t *testing.T) {
	cases := []struct {
		in   []int
		want int
	}{
		{nil, 0},
		{[]int{22}, 22},
		{[]int{22, 3000}, 3000},
		{[]int{3000, 22}, 3000},
		{[]int{80, 443}, 80},
		{[]int{8080, 9090}, 8080},
		{[]int{22, 2222, 9090}, 9090},
		{[]int{4000, 5000}, 5000},
		{[]int{7000, 6000}, 6000},
	}
	for _, c := range cases {
		if got := PickAppContainerPort(c.in); got != c.want {
			t.Errorf("PickAppContainerPort(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}
